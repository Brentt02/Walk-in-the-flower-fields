/** Optional local ambience and footsteps for Evermeadow.
 * Place files in ../audio/ using the exact names described in audio/README.txt.
 */
export class AudioManager {
  constructor() {
    this.ambience = new Audio("./audio/meadow-ambience.mp3");
    this.ambience.loop = true;
    this.ambience.volume = 0.26;
    this.ambience.preload = "auto";

    this.footstep = new Audio("./audio/grass-footstep.mp3");
    this.footstep.preload = "auto";
    this.footstep.volume = 0.34;

    this.started = false;
    this.stepTimer = 0;
    this.disposed = false;

    // Browsers only allow audio after a real user gesture.
    this.unlockAudio = () => {
      if (this.started || this.disposed) return;
      this.started = true;
      this.ambience.play().catch(() => {
        // If autoplay is blocked, allow the next gesture to retry.
        this.started = false;
      });
    };

    window.addEventListener("pointerdown", this.unlockAudio);
    window.addEventListener("keydown", this.unlockAudio);
  }

  update(dt, isMoving, isSprinting) {
    if (!this.started || this.disposed) return;

    if (!isMoving) {
      this.stepTimer = 0;
      return;
    }

    this.stepTimer += dt;
    const interval = isSprinting ? 0.34 : 0.52;
    if (this.stepTimer < interval) return;
    this.stepTimer %= interval;

    // Avoid stacking many copies if a previous step is still playing.
    const step = this.footstep.cloneNode();
    step.volume = isSprinting ? 0.43 : 0.31;
    step.play().catch(() => {});
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.ambience.pause();
    this.footstep.pause();
    window.removeEventListener("pointerdown", this.unlockAudio);
    window.removeEventListener("keydown", this.unlockAudio);
  }
}
