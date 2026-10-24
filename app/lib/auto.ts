/**
 * Vehicles and spare parts in the Auto category: the spec sheet buyers expect from car sites
 * (make, model, year, mileage, transmission...) and part numbers with the vehicles a part fits.
 * Shared by the listing form, the product page, cards and the search filters.
 */
export type AutoType = "vehicle" | "part";

export type PartFit = { make: string; model: string; yearFrom?: number; yearTo?: number };

export type AutoDetails = {
  type: AutoType;
  condition?: "new" | "used" | "reconditioned";
  location?: string;
  // Vehicles
  make?: string;
  model?: string;
  grade?: string; // trim, e.g. "F", "Hybrid G"
  year?: number;
  mileageKm?: number;
  transmission?: "automatic" | "manual" | "cvt";
  fuel?: "petrol" | "diesel" | "hybrid" | "electric" | "lpg";
  engineCc?: number;
  drive?: "2wd" | "4wd" | "awd";
  steering?: "right" | "left";
  bodyType?: string;
  colour?: string;
  seats?: number;
  doors?: number;
  chassisEnding?: string; // last characters of the chassis/VIN, never the full number
  dutyPaid?: boolean; // cleared and registered in Malawi
  inCountry?: boolean; // false = still being imported / in transit
  features?: string[];
  // Parts
  partCategory?: string;
  partNumber?: string;
  oemNumber?: string;
  brand?: string;
  position?: string; // e.g. "Front left"
  fits?: PartFit[];
};

/** The category whose listings get the vehicle / spare-part details. */
export const AUTO_CATEGORY_SLUG = "auto";

export const MAKES = [
  "Toyota", "Nissan", "Honda", "Mazda", "Mitsubishi", "Subaru", "Suzuki", "Isuzu", "Daihatsu", "Lexus",
  "Mercedes-Benz", "BMW", "Volkswagen", "Audi", "Ford", "Hyundai", "Kia", "Land Rover", "Jeep", "Peugeot",
  "Renault", "Tata", "Mahindra", "Hino", "Fuso", "Scania", "Volvo", "Yamaha", "Bajaj", "TVS", "Other",
];

/** Popular models, offered as suggestions (any model can be typed). */
export const POPULAR_MODELS: Record<string, string[]> = {
  Toyota: ["Vitz", "Corolla", "Axio", "Fielder", "Premio", "Allion", "Belta", "Passo", "Raum", "Sienta", "Wish", "Noah", "Voxy", "Hiace", "Hilux", "Land Cruiser", "Prado", "RAV4", "Harrier", "Mark X", "Crown", "Probox", "Succeed", "Prius", "Aqua", "Ist", "Rush", "Fortuner", "Coaster"],
  Nissan: ["March", "Note", "Tiida", "Sylphy", "Bluebird", "X-Trail", "Dualis", "Juke", "Navara", "Hardbody", "Caravan", "NV350", "Serena", "Wingroad", "AD Van", "Patrol"],
  Honda: ["Fit", "Fit Shuttle", "Insight", "Vezel", "CR-V", "Freed", "Stream", "Odyssey", "Civic", "Accord"],
  Mazda: ["Demio", "Axela", "Atenza", "CX-5", "CX-3", "Premacy", "Bongo", "BT-50"],
  Mitsubishi: ["Colt", "Lancer", "Outlander", "RVR", "Pajero", "Pajero Mini", "Delica", "Triton", "Canter"],
  Subaru: ["Impreza", "Legacy", "Forester", "Outback", "XV"],
  Suzuki: ["Swift", "Alto", "Every", "Carry", "Jimny", "Escudo", "Wagon R", "Solio"],
  Isuzu: ["D-Max", "Elf", "MU-X", "Forward", "Trooper"],
  "Mercedes-Benz": ["C-Class", "E-Class", "S-Class", "ML", "GLE", "Sprinter", "Actros"],
  BMW: ["3 Series", "5 Series", "X1", "X3", "X5"],
  Volkswagen: ["Polo", "Golf", "Passat", "Tiguan", "Touareg", "Amarok", "Caddy"],
  Ford: ["Ranger", "Everest", "Fiesta", "Focus", "Escape", "Transit"],
};

export const TRANSMISSIONS = [
  { value: "automatic", label: "Automatic" },
  { value: "manual", label: "Manual" },
  { value: "cvt", label: "CVT" },
] as const;

export const FUELS = [
  { value: "petrol", label: "Petrol" },
  { value: "diesel", label: "Diesel" },
  { value: "hybrid", label: "Hybrid" },
  { value: "electric", label: "Electric" },
  { value: "lpg", label: "LPG" },
] as const;

export const DRIVES = [
  { value: "2wd", label: "2WD" },
  { value: "4wd", label: "4WD" },
  { value: "awd", label: "AWD" },
] as const;

export const BODY_TYPES = ["Sedan", "Hatchback", "Station wagon", "SUV", "Pickup", "Double cab", "Van", "Minibus", "Bus", "Truck", "Coupe", "Convertible", "Motorcycle", "Tractor", "Other"];

export const CONDITIONS = [
  { value: "used", label: "Used" },
  { value: "reconditioned", label: "Ex-Japan / reconditioned" },
  { value: "new", label: "New" },
] as const;

export const VEHICLE_FEATURES = [
  "Air conditioning", "Power steering", "Power windows", "Central locking", "Keyless entry", "ABS brakes",
  "Airbags", "Reverse camera", "Navigation", "Bluetooth / USB", "Cruise control", "Leather seats", "Sunroof",
  "Alloy wheels", "Fog lights", "Tow bar", "Roof rails", "Third row seats", "Push start", "Spare key",
];

export const PART_CATEGORIES = [
  "Engine", "Filters & service parts", "Brakes", "Suspension & steering", "Transmission & clutch", "Electrical & batteries",
  "Lights", "Cooling & radiators", "Body panels & mirrors", "Glass", "Interior", "Exhaust", "Tyres & wheels",
  "Fuel system", "Accessories", "Other",
];

const label = <T extends { value: string; label: string }>(list: readonly T[], v: string | undefined) => list.find((x) => x.value === v)?.label;

/** Short line for cards: "2015 · 68,000 km · Automatic · Petrol" or "Part no. 04465-02220 · Fits Toyota Corolla". */
export function autoSummary(a: AutoDetails | null | undefined) {
  if (!a) return null;
  if (a.type === "part") {
    const fit = a.fits?.[0];
    return [a.partNumber ? `Part no. ${a.partNumber}` : a.partCategory, fit ? `Fits ${fit.make} ${fit.model}${fitYears(fit)}` : null].filter(Boolean).join(" · ");
  }
  return [a.year, a.mileageKm != null ? `${a.mileageKm.toLocaleString("en-US")} km` : null, label(TRANSMISSIONS, a.transmission), label(FUELS, a.fuel)].filter(Boolean).join(" · ");
}

export function fitYears(f: PartFit) {
  if (f.yearFrom && f.yearTo) return ` ${f.yearFrom}–${f.yearTo}`;
  if (f.yearFrom) return ` ${f.yearFrom}+`;
  if (f.yearTo) return ` up to ${f.yearTo}`;
  return "";
}

/** The spec sheet rows for the product page. */
export function autoSpecRows(a: AutoDetails): [string, string][] {
  const rows: [string, string | number | undefined | null][] =
    a.type === "vehicle"
      ? [
          ["Make", a.make],
          ["Model", a.model],
          ["Grade", a.grade],
          ["Year", a.year],
          ["Mileage", a.mileageKm != null ? `${a.mileageKm.toLocaleString("en-US")} km` : null],
          ["Transmission", label(TRANSMISSIONS, a.transmission)],
          ["Fuel", label(FUELS, a.fuel)],
          ["Engine", a.engineCc ? `${a.engineCc.toLocaleString("en-US")} cc` : null],
          ["Drive", label(DRIVES, a.drive)],
          ["Steering", a.steering === "left" ? "Left-hand drive" : a.steering === "right" ? "Right-hand drive" : null],
          ["Body type", a.bodyType],
          ["Colour", a.colour],
          ["Seats", a.seats],
          ["Doors", a.doors],
          ["Condition", label(CONDITIONS, a.condition)],
          ["Chassis no. ends", a.chassisEnding],
          ["Duty", a.dutyPaid == null ? null : a.dutyPaid ? "Duty paid, registered" : "Duty not paid"],
          ["Availability", a.inCountry == null ? null : a.inCountry ? "In the country" : "Being imported"],
          ["Location", a.location],
        ]
      : [
          ["Part category", a.partCategory],
          ["Part number", a.partNumber],
          ["OEM number", a.oemNumber],
          ["Brand", a.brand],
          ["Position", a.position],
          ["Condition", label(CONDITIONS, a.condition)],
          ["Location", a.location],
        ];
  return rows.filter((r): r is [string, string | number] => r[1] != null && r[1] !== "").map(([k, v]) => [k, String(v)]);
}

/** Reads the Auto section of the listing form. Returns an error message for bad input. */
export function autoFromForm(form: FormData): AutoDetails | string {
  const text = (k: string, max = 80) => String(form.get(k) ?? "").trim().slice(0, max) || undefined;
  const int = (k: string, min: number, max: number) => {
    const raw = String(form.get(k) ?? "").replace(/[\s,]/g, "");
    if (!raw) return undefined;
    const n = Number(raw);
    return Number.isInteger(n) && n >= min && n <= max ? n : NaN;
  };
  const pick = <T extends string>(k: string, allowed: readonly T[]) => {
    const v = String(form.get(k) ?? "") as T;
    return allowed.includes(v) ? v : undefined;
  };
  const yesNo = (k: string) => (form.get(k) === "yes" ? true : form.get(k) === "no" ? false : undefined);
  const type = form.get("autoType") === "part" ? "part" : "vehicle";
  const condition = pick("autoCondition", ["new", "used", "reconditioned"] as const);
  const location = text("autoLocation", 120);
  const thisYear = new Date().getFullYear();

  if (type === "vehicle") {
    const year = int("year", 1950, thisYear + 1);
    const mileageKm = int("mileageKm", 0, 2_000_000);
    const engineCc = int("engineCc", 50, 20_000);
    const seats = int("seats", 1, 100);
    const doors = int("doors", 0, 10);
    for (const [name, v] of [["year", year], ["mileage", mileageKm], ["engine size", engineCc], ["seats", seats], ["doors", doors]] as const) {
      if (Number.isNaN(v)) return `Check the ${name}.`;
    }
    const make = text("make");
    if (!make) return "Choose the make.";
    if (!text("model")) return "Enter the model.";
    if (!year) return "Enter the year.";
    return {
      type,
      condition,
      location,
      make,
      model: text("model"),
      grade: text("grade"),
      year,
      mileageKm,
      transmission: pick("transmission", ["automatic", "manual", "cvt"] as const),
      fuel: pick("fuel", ["petrol", "diesel", "hybrid", "electric", "lpg"] as const),
      engineCc,
      drive: pick("drive", ["2wd", "4wd", "awd"] as const),
      steering: pick("steering", ["right", "left"] as const),
      bodyType: BODY_TYPES.includes(String(form.get("bodyType"))) ? String(form.get("bodyType")) : undefined,
      colour: text("colour", 40),
      seats,
      doors,
      chassisEnding: text("chassisEnding", 8)?.toUpperCase(),
      dutyPaid: yesNo("dutyPaid"),
      inCountry: yesNo("inCountry"),
      features: form.getAll("vehicleFeature").map(String).filter((f) => VEHICLE_FEATURES.includes(f)),
    };
  }

  const fits: PartFit[] = [];
  const makes = form.getAll("fitMake").map(String);
  const models = form.getAll("fitModel").map(String);
  const froms = form.getAll("fitFrom").map(String);
  const tos = form.getAll("fitTo").map(String);
  for (let i = 0; i < Math.min(makes.length, 10); i++) {
    const make = makes[i].trim().slice(0, 40);
    const model = (models[i] ?? "").trim().slice(0, 60);
    if (!make && !model) continue;
    const y = (s?: string) => {
      const n = Number(s);
      return Number.isInteger(n) && n >= 1950 && n <= thisYear + 1 ? n : undefined;
    };
    fits.push({ make: make || "Any", model: model || "Any model", yearFrom: y(froms[i]), yearTo: y(tos[i]) });
  }
  const partCategory = PART_CATEGORIES.includes(String(form.get("partCategory"))) ? String(form.get("partCategory")) : undefined;
  if (!partCategory) return "Choose the part category.";
  return {
    type,
    condition,
    location,
    partCategory,
    partNumber: text("partNumber", 40)?.toUpperCase(),
    oemNumber: text("oemNumber", 40)?.toUpperCase(),
    brand: text("brand", 40),
    position: text("position", 40),
    fits,
  };
}
