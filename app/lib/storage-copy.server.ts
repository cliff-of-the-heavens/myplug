import { and, asc, desc, eq, gte, isNull, lt, ne, or, sql, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import { Transform } from "node:stream";
import { db, schema } from "~/db/client.server";
import { getStorageSettings, openStoredFile, StorageError, storedSize, testFtp, testR2, writeToBackend, type ActiveBackend, type StorageConfig } from "./storage.server";

const { storedFiles, storageCopyJobs: jobs } = schema;
type FileRow = typeof storedFiles.$inferSelect;

const MAX_ATTEMPTS = 3;
const LOCK_MS = 6 * 60_000; // longer than any function can run, so a crashed run can't block for long
const PAUSE_MS = 300; // a breather between files, to stay gentle on both servers
const MULTIPART_BYTES = 50 * 1024 * 1024;

/**
 * Every column that holds a reference to a stored file. A new column that stores an upload must be
 * added here, or it keeps pointing at the old copy after a move.
 */
const PUBLIC_COLUMNS: AnyPgColumn[] = [
  schema.stores.logoUrl,
  schema.products.imageUrl,
  schema.products.previewUrl,
  schema.productImages.url,
  schema.promotions.proofUrl,
  schema.transportJobs.imageUrl,
  schema.hireCars.imageUrl,
  schema.adCampaigns.creativeUrl,
  schema.adCampaigns.proofUrl,
  schema.adFreePasses.proofUrl,
  schema.bandRequests.proofUrl,
  schema.bills.proofUrl,
  schema.planPrepayments.proofUrl,
  schema.requests.imageUrl,
  schema.messages.imageUrl,
];
const PUBLIC_ARRAY_COLUMNS: AnyPgColumn[] = [schema.hireCars.images];
const PRIVATE_COLUMNS: AnyPgColumn[] = [
  schema.products.mediaKey,
  schema.couriers.facePhotoKey,
  schema.couriers.idDocumentKey,
  schema.businessLicenses.documentKey,
  schema.deliveries.collectorPhotoKey,
];

/** Points every reference and the file's own record at the new copy, in one atomic statement. */
async function switchReferences(file: FileRow, target: ActiveBackend, newRef: string) {
  const name = (c: AnyPgColumn) => sql.identifier(c.name);
  const updates: SQL[] = [];
  for (const c of file.visibility === "public" ? PUBLIC_COLUMNS : PRIVATE_COLUMNS) {
    updates.push(sql`UPDATE ${c.table} SET ${name(c)} = ${newRef} WHERE ${name(c)} = ${file.ref}`);
  }
  if (file.visibility === "public") {
    for (const c of PUBLIC_ARRAY_COLUMNS) {
      updates.push(sql`UPDATE ${c.table} SET ${name(c)} = array_replace(${name(c)}, ${file.ref}::text, ${newRef}::text) WHERE ${file.ref}::text = ANY(${name(c)})`);
    }
  }
  const cte = sql.join(
    updates.map((u, i) => sql`${sql.raw(`r${i}`)} AS (${u})`),
    sql`, `,
  );
  await db.execute(sql`
    WITH ${cte}
    UPDATE stored_files
    SET backend = ${target}, ref = ${newRef}, previous_backend = ${file.backend}, previous_ref = ${file.ref},
        moved_at = now(), copy_error = NULL
    WHERE id = ${file.id}
  `);
}

async function copyOne(file: FileRow, target: ActiveBackend, config: StorageConfig) {
  let bytes = 0;
  const counter = new Transform({
    transform(chunk: Buffer, _enc, done) {
      bytes += chunk.length;
      done(null, chunk);
    },
  });
  counter.on("error", () => {}); // reported through readFailed or the write below
  const source = await openStoredFile(file, config);
  // A read can fail before the upload is listening, so it's watched separately from the write.
  const readFailed = new Promise<never>((_, reject) => {
    source.once("error", (e) => {
      counter.destroy(e);
      reject(e);
    });
  });
  readFailed.catch(() => {});
  source.pipe(counter);

  const multipart = file.sizeBytes === null || file.sizeBytes > MULTIPART_BYTES;
  const contentType = file.contentType ?? "application/octet-stream";
  const writing = writeToBackend(target, file.visibility, file.name, counter, contentType, config, { overwrite: true, multipart });
  writing.catch(() => {});
  const newRef = await Promise.race([writing, readFailed]).catch((e) => {
    source.destroy(); // stop reading from the old location
    throw e;
  });

  const arrived = await storedSize(target, file.visibility, file.name, newRef, config);
  if (arrived !== bytes || (file.sizeBytes !== null && arrived !== file.sizeBytes)) {
    throw new StorageError(`The copy is incomplete: ${arrived} bytes arrived, expected ${file.sizeBytes ?? bytes}.`);
  }
  await switchReferences(file, target, newRef);
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function nextFile(target: ActiveBackend) {
  const [file] = await db
    .select()
    .from(storedFiles)
    .where(and(ne(storedFiles.backend, target), lt(storedFiles.copyAttempts, MAX_ATTEMPTS)))
    .orderBy(asc(storedFiles.copyAttempts), asc(storedFiles.createdAt))
    .limit(1);
  return file ?? null;
}

/**
 * Copies files one at a time until the time or file budget runs out. Runs from the daily job, and
 * in short bursts while an admin has System settings open. Only one run can be active at a time.
 */
export async function runCopyBatch({ budgetMs, maxFiles }: { budgetMs: number; maxFiles: number }) {
  const now = new Date();
  const [job] = await db
    .update(jobs)
    .set({ lockedUntil: new Date(now.getTime() + LOCK_MS), lastRunAt: now })
    .where(and(eq(jobs.status, "running"), or(isNull(jobs.lockedUntil), lt(jobs.lockedUntil, now))))
    .returning();
  if (!job) return { ran: false, copied: 0, failed: 0 };

  const result = { ran: true, copied: 0, failed: 0 };
  try {
    const { backend: _, ...config } = await getStorageSettings();
    const deadline = Date.now() + budgetMs;
    while (Date.now() < deadline && result.copied + result.failed < maxFiles) {
      const current = await db.query.storageCopyJobs.findFirst({ where: eq(jobs.id, job.id), columns: { status: true } });
      if (current?.status !== "running") break; // an admin pressed Stop

      const file = await nextFile(job.target);
      if (!file) {
        await db.update(jobs).set({ status: "done", finishedAt: new Date() }).where(eq(jobs.id, job.id));
        break;
      }
      // Counted first, so a file that crashes the function can't be retried forever.
      await db.update(storedFiles).set({ copyAttempts: sql`${storedFiles.copyAttempts} + 1` }).where(eq(storedFiles.id, file.id));
      try {
        await copyOne(file, job.target, config);
        result.copied++;
      } catch (e) {
        result.failed++;
        await db.update(storedFiles).set({ copyError: (e instanceof Error ? e.message : String(e)).slice(0, 500) }).where(eq(storedFiles.id, file.id));
      }
      await sleep(PAUSE_MS);
    }
  } finally {
    await db.update(jobs).set({ lockedUntil: null }).where(eq(jobs.id, job.id));
  }
  return result;
}

/** Starts copying everything not already on `target`. Starting again retries files that failed. */
export async function startCopyJob(target: ActiveBackend) {
  const { ftp, r2 } = await getStorageSettings();
  if (target === "blob" && !process.env.BLOB_READ_WRITE_TOKEN) throw new StorageError("Connect Vercel Blob first: BLOB_READ_WRITE_TOKEN is missing.");
  if (target === "local" && process.env.VERCEL) throw new StorageError("Local disk isn't available on Vercel.");
  // These prove it can write and that the files will be reachable.
  if (target === "ftp") await testFtp(ftp);
  if (target === "r2") await testR2(r2);

  const running = await db.query.storageCopyJobs.findFirst({ where: eq(jobs.status, "running"), columns: { id: true } });
  if (running) throw new StorageError("A copy is already running.");
  await db.update(storedFiles).set({ copyAttempts: 0, copyError: null }).where(ne(storedFiles.backend, target));
  await db.insert(jobs).values({ target }).onConflictDoNothing();
}

export async function stopCopyJob() {
  await db.update(jobs).set({ status: "stopped", finishedAt: new Date() }).where(eq(jobs.status, "running"));
}

/** Where files live now, and how the latest copy is going. */
export async function getCopyStatus() {
  const [byBackend, job] = await Promise.all([
    db
      .select({ backend: storedFiles.backend, files: sql<number>`count(*)::int`, bytes: sql<number>`coalesce(sum(${storedFiles.sizeBytes}), 0)::float8` })
      .from(storedFiles)
      .groupBy(storedFiles.backend),
    db.query.storageCopyJobs.findFirst({ orderBy: desc(jobs.createdAt), columns: { id: true, target: true, status: true, lastRunAt: true, finishedAt: true } }),
  ]);
  const total = byBackend.reduce((sum, b) => sum + b.files, 0);
  const onTarget = job ? (byBackend.find((b) => b.backend === job.target)?.files ?? 0) : 0;
  const failures = job
    ? await db
        .select({ name: storedFiles.name, error: storedFiles.copyError })
        .from(storedFiles)
        .where(and(ne(storedFiles.backend, job.target), gte(storedFiles.copyAttempts, MAX_ATTEMPTS)))
        .orderBy(asc(storedFiles.createdAt))
        .limit(5)
    : [];
  return {
    byBackend,
    total,
    job: job ? { ...job, lastRunAt: job.lastRunAt?.toISOString() ?? null, finishedAt: job.finishedAt?.toISOString() ?? null } : null,
    onTarget,
    failures,
  };
}
export type CopyStatus = Awaited<ReturnType<typeof getCopyStatus>>;
