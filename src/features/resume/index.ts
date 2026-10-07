/**
 * Resume points — where an album or playlist was left off, the "Resume" button
 * on its page and the "Continue listening" rail on Home. The app shell wires
 * the tracker and the track loaders through `initResumePoints`.
 */
export { initResumePoints, type ResumePointsDeps } from './initResumePoints';
export { ResumeButton } from './components/ResumeButton';
export { ContinueListeningRail } from './components/ContinueListeningRail';
export { useResumePointsStore, type ResumePoint } from './store/resumePointsStore';
