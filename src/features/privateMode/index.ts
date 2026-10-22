// Store only: playback modules on the boot path import this barrel, so UI
// (lucide-react) lives behind `@/features/privateMode/ui`.
export { usePrivateModeStore, isPrivateModeActive } from './privateModeStore';
