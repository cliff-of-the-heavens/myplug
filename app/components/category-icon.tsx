import {
  BabyIcon,
  Building2Icon,
  HouseIcon,
  KeyRoundIcon,
  LandPlotIcon,
  CakeIcon,
  CameraIcon,
  ChefHatIcon,
  Music2Icon,
  PartyPopperIcon,
  BookOpenIcon,
  CarIcon,
  DumbbellIcon,
  Gamepad2Icon,
  type LucideIcon,
  PaletteIcon,
  ShirtIcon,
  ShoppingBasketIcon,
  SmartphoneIcon,
  SofaIcon,
  SparklesIcon,
  TagIcon,
} from "lucide-react";

const ICONS: Record<string, LucideIcon> = {
  house: HouseIcon,
  land: LandPlotIcon,
  key: KeyRoundIcon,
  building: Building2Icon,
  smartphone: SmartphoneIcon,
  shirt: ShirtIcon,
  sofa: SofaIcon,
  sparkles: SparklesIcon,
  dumbbell: DumbbellIcon,
  baby: BabyIcon,
  basket: ShoppingBasketIcon,
  gamepad: Gamepad2Icon,
  car: CarIcon,
  book: BookOpenIcon,
  palette: PaletteIcon,
  music: Music2Icon,
  party: PartyPopperIcon,
  cake: CakeIcon,
  camera: CameraIcon,
  chef: ChefHatIcon,
};

export function CategoryIcon({ name, className }: { name: string | null; className?: string }) {
  const Icon = (name && ICONS[name]) || TagIcon;
  return <Icon className={className} />;
}

/** Rotating tile colours for category chips. */
export const TILE_COLORS = [
  "bg-primary/12 text-primary",
  "bg-accent/15 text-accent",
  "bg-highlight/30 text-highlight-foreground dark:text-highlight",
  "bg-brand-violet/12 text-brand-violet",
  "bg-success/15 text-success",
  "bg-destructive/10 text-destructive",
];
