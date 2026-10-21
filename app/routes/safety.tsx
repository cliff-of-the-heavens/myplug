import { EyeOffIcon, FlagIcon, GavelIcon, ShieldCheckIcon } from "lucide-react";
import { Container, PageHeader } from "~/components/page";
import { Card, CardContent } from "~/components/ui/card";
import type { Route } from "./+types/safety";

export const meta: Route.MetaFunction = () => [{ title: "Community guidelines · MyPlug" }];

export default function Safety() {
  const steps = [
    { icon: FlagIcon, title: "1. Report it", text: "Tap “Report” under any product photo, request photo, store or chat image. Choose a reason; the owner never sees who reported." },
    { icon: EyeOffIcon, title: "2. It gets hidden", text: "Images reported as nudity are hidden immediately. Anything reported by 3 different people is hidden automatically until reviewed." },
    { icon: GavelIcon, title: "3. A moderator decides", text: "Our team either takes the content down (and can suspend the account) or restores it if it follows the rules." },
  ];

  return (
    <Container className="max-w-3xl py-10">
      <PageHeader title="Community guidelines" description="Keeping MyPlug safe for buyers and sellers." />

      <section className="grid gap-3">
        <h2 className="text-xl font-extrabold">Not allowed</h2>
        <ul className="grid list-disc gap-1 pl-5 text-muted-foreground">
          <li>Nudity, sexual content or anything involving minors</li>
          <li>Violent, gory or self-harm imagery</li>
          <li>Hate speech, harassment or threats</li>
          <li>Illegal or prohibited goods (weapons, drugs, stolen goods, counterfeits)</li>
          <li>Scams, misleading listings or images you don't have the right to use</li>
        </ul>
      </section>

      <section id="reporting" className="mt-10 grid scroll-mt-40 gap-4">
        <h2 className="text-xl font-extrabold">How reporting works</h2>
        {steps.map((s) => (
          <Card key={s.title}>
            <CardContent className="flex gap-4 pt-5">
              <span className="flex size-10 shrink-0 items-center justify-center rounded-xl bg-primary/12 text-primary">
                <s.icon className="size-5" />
              </span>
              <div>
                <p className="font-bold">{s.title}</p>
                <p className="text-sm text-muted-foreground">{s.text}</p>
              </div>
            </CardContent>
          </Card>
        ))}
        <p className="flex items-center gap-2 rounded-xl bg-secondary p-4 text-sm text-secondary-foreground">
          <ShieldCheckIcon className="size-5 shrink-0" />
          Content that may be illegal (e.g. child sexual abuse material) is removed immediately and reported to the
          authorities as required by law.
        </p>
      </section>
    </Container>
  );
}
