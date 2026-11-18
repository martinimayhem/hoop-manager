// Every icon in the game is a Lucide SVG icon (GAME_FLOW §6.1a rule 2: one vector icon set, no emoji
// or text symbols). Game data names its icons with a plain word (OptionInfo.icon, clutch calls, team
// talks); this maps those names to Lucide's drawings, so the game layer never imports the UI.

import {
  ArrowLeft,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  Menu,
  Pause,
  Sparkles,
  TriangleAlert,
  Volume2,
  VolumeX,
  X,
  ArrowDown,
  ArrowLeftRight,
  ArrowUp,
  Ban,
  BatteryMedium,
  BicepsFlexed,
  BrickWall,
  Flame,
  Hand,
  Hourglass,
  Lightbulb,
  Megaphone,
  MessageSquare,
  Play,
  Rabbit,
  Repeat2,
  Scale,
  Snowflake,
  Star,
  Target,
  ThumbsUp,
  Timer,
  Trophy,
  Turtle,
  User,
  Users,
  Wind,
  Zap,
  type LucideIcon,
  type LucideProps,
} from 'lucide-react';

/** The icon names game data may use. */
export const ICONS = {
  biceps: BicepsFlexed,
  scale: Scale,
  target: Target,
  repeat: Repeat2,
  zap: Zap,
  user: User,
  users: Users,
  wall: BrickWall,
  flame: Flame,
  turtle: Turtle,
  play: Play,
  rabbit: Rabbit,
  snowflake: Snowflake,
  star: Star,
  timer: Timer,
  ban: Ban,
  hand: Hand,
  thumbsUp: ThumbsUp,
  megaphone: Megaphone,
  wind: Wind,
  message: MessageSquare,
  lightbulb: Lightbulb,
  battery: BatteryMedium,
  hourglass: Hourglass,
  swap: ArrowLeftRight,
  up: ArrowUp,
  down: ArrowDown,
  trophy: Trophy,
} satisfies Record<string, LucideIcon>;

export type IconName = keyof typeof ICONS;

// Interface icons used directly by the screens, at the text's size, in the current colour.
const ui = (C: LucideIcon) =>
  function UiIcon(props: LucideProps) {
    return <C size="1.1em" strokeWidth={2.25} aria-hidden="true" {...props} className={`icon-svg ${props.className ?? ''}`} />;
  };
/** "Next", "go on", "start": after a button's words. */
export const NextIcon = ui(ChevronRight);
export const PrevIcon = ui(ChevronLeft);
export const BackIcon = ui(ArrowLeft);
export const MenuIcon = ui(Menu);
export const CheckIcon = ui(Check);
export const CrossIcon = ui(X);
export const SortDownIcon = ui(ChevronDown);
export const SortUpIcon = ui(ChevronUp);
export const PlayIcon = ui(Play);
export const PauseIcon = ui(Pause);
export const HighlightsIcon = ui(Sparkles);
export const SoundOnIcon = ui(Volume2);
export const SoundOffIcon = ui(VolumeX);
export const WarningIcon = ui(TriangleAlert);
export const TrophyIcon = ui(Trophy);

/** An icon by name, at the text's size by default, drawn in the current colour. */
export function Icon({ name, size = '1.1em', className, ...rest }: { name: IconName | string } & LucideProps) {
  const C = (ICONS as Record<string, LucideIcon>)[name] ?? Star;
  return <C size={size} strokeWidth={2} aria-hidden="true" {...rest} className={`icon-svg ${className ?? ''}`} />;
}
