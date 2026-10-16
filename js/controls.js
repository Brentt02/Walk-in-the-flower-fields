import * as THREE from "three";
import { terrainHeight } from "./world.js";

/** First-person desktop and touch controls for Evermeadow. */
export class Controls {
  constructor(camera, canvas, mobile = false) {
    this.camera = camera;
    this.canvas = canvas;
    this.mobile = mobile;
    this.hint = document.getElementById("hint");
    if (this.hint && mobile) this.hint.textContent = "Drag the right side to look around · Use the joystick to wander";
    this.joystick = document.getElementById("joystick");
    this.stick = document.getElementById("stick");
    this.lookZone = document.getElementById("look-zone");

    this.keys = new Set();
    this.yaw = 0;
    this.pitch = -0.045;
    this.lookSensitivity = mobile ? 0.006 : 0.0022;
    this.moveSpeed = 6.2;
    this.sprintMultiplier = 1.65;
    this.eyeHeight = 1.65;
    this.joystickInput = new THREE.Vector2();
    this.joystickPointer = null;
    this.lookPointer = null;
    this.lastLook = null;
    this.disposed = false;

    this.camera.rotation.order = "YXZ";
    this.camera.position.set(0, terrainHeight(0, 0) + this.eyeHeight, 0);
    this.applyRotation();

    this.onKeyDown = event => {
      const key = event.key.toLowerCase();
      if (["w", "a", "s", "d", "shift", "arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(key)) {
        if (key.startsWith("arrow") || key === " ") event.preventDefault();
        this.keys.add(key);
      }
    };
    this.onKeyUp = event => this.keys.delete(event.key.toLowerCase());
    this.onBlur = () => this.keys.clear();
    this.onVisibilityChange = () => {
      if (document.hidden) this.keys.clear();
    };
    this.onMouseMove = event => {
      if (document.pointerLockElement === this.canvas) {
        this.rotate(event.movementX, event.movementY);
      }
    };
    this.onPointerLockChange = () => {
      const locked = document.pointerLockElement === this.canvas;
      if (this.hint) this.hint.classList.toggle("hidden", locked);
    };
    this.onCanvasClick = () => {
      if (!this.mobile && document.pointerLockElement !== this.canvas && this.canvas.requestPointerLock) {
        const result = this.canvas.requestPointerLock();
        if (result && typeof result.catch === "function") result.catch(() => {});
      }
    };

    window.addEventListener("keydown", this.onKeyDown, { passive: false });
    window.addEventListener("keyup", this.onKeyUp);
    window.addEventListener("blur", this.onBlur);
    document.addEventListener("visibilitychange", this.onVisibilityChange);
    document.addEventListener("mousemove", this.onMouseMove);
    document.addEventListener("pointerlockchange", this.onPointerLockChange);
    this.canvas.addEventListener("click", this.onCanvasClick);

    this.onCanvasDragStart = event => {
      if (this.mobile || event.pointerType === "touch") return;
      if (document.pointerLockElement === this.canvas) return;
      this.lookPointer = event.pointerId;
      this.lastLook = { x: event.clientX, y: event.clientY };
      this.canvas.setPointerCapture?.(event.pointerId);
    };
    this.onCanvasDragMove = event => {
      if (this.lookPointer !== event.pointerId || !this.lastLook) return;
      const dx = event.clientX - this.lastLook.x;
      const dy = event.clientY - this.lastLook.y;
      this.lastLook = { x: event.clientX, y: event.clientY };
      this.rotate(dx, dy, 0.65);
    };
    this.onCanvasDragEnd = event => {
      if (this.lookPointer === event.pointerId) {
        this.lookPointer = null;
        this.lastLook = null;
      }
    };
    this.canvas.addEventListener("pointerdown", this.onCanvasDragStart);
    this.canvas.addEventListener("pointermove", this.onCanvasDragMove);
    this.canvas.addEventListener("pointerup", this.onCanvasDragEnd);
    this.canvas.addEventListener("pointercancel", this.onCanvasDragEnd);

    this.onJoystickDown = event => {
      if (!this.mobile || this.joystickPointer !== null) return;
      event.preventDefault();
      this.joystickPointer = event.pointerId;
      this.joystick.setPointerCapture?.(event.pointerId);
      this.updateJoystick(event);
    };
    this.onJoystickMove = event => {
      if (this.joystickPointer !== event.pointerId) return;
      event.preventDefault();
      this.updateJoystick(event);
    };
    this.onJoystickEnd = event => {
      if (this.joystickPointer !== event.pointerId) return;
      this.joystickPointer = null;
      this.joystickInput.set(0, 0);
      this.positionStick(0, 0);
    };
    if (this.joystick) {
      this.joystick.addEventListener("pointerdown", this.onJoystickDown);
      this.joystick.addEventListener("pointermove", this.onJoystickMove);
      this.joystick.addEventListener("pointerup", this.onJoystickEnd);
      this.joystick.addEventListener("pointercancel", this.onJoystickEnd);
    }

    this.onLookDown = event => {
      if (!this.mobile || this.lookPointer !== null) return;
      event.preventDefault();
      this.lookPointer = event.pointerId;
      this.lastLook = { x: event.clientX, y: event.clientY };
      this.lookZone?.setPointerCapture?.(event.pointerId);
    };
    this.onLookMove = event => {
      if (!this.mobile || this.lookPointer !== event.pointerId || !this.lastLook) return;
      event.preventDefault();
      const dx = event.clientX - this.lastLook.x;
      const dy = event.clientY - this.lastLook.y;
      this.lastLook = { x: event.clientX, y: event.clientY };
      this.rotate(dx, dy);
    };
    this.onLookEnd = event => {
      if (this.lookPointer === event.pointerId) {
        this.lookPointer = null;
        this.lastLook = null;
      }
    };
    if (this.lookZone) {
      this.lookZone.addEventListener("pointerdown", this.onLookDown);
      this.lookZone.addEventListener("pointermove", this.onLookMove);
      this.lookZone.addEventListener("pointerup", this.onLookEnd);
      this.lookZone.addEventListener("pointercancel", this.onLookEnd);
    }

    if (this.mobile) document.body.classList.add("touch");
  }

  rotate(dx, dy, scale = 1) {
    this.yaw -= dx * this.lookSensitivity * scale;
    this.pitch -= dy * this.lookSensitivity * scale;
    this.pitch = THREE.MathUtils.clamp(this.pitch, -1.35, 1.35);
    this.applyRotation();
  }

  applyRotation() {
    this.camera.rotation.set(this.pitch, this.yaw, 0, "YXZ");
  }

  updateJoystick(event) {
    const rect = this.joystick.getBoundingClientRect();
    const radius = Math.min(rect.width, rect.height) * 0.36;
    let x = (event.clientX - (rect.left + rect.width / 2)) / radius;
    let y = (event.clientY - (rect.top + rect.height / 2)) / radius;
    const length = Math.hypot(x, y);
    if (length > 1) { x /= length; y /= length; }
    this.joystickInput.set(x, y);
    this.positionStick(x, y);
  }

  positionStick(x, y) {
    if (!this.stick) return;
    const radius = 36;
    this.stick.style.transform = `translate(${x * radius}px, ${y * radius}px)`;
  }

  update(dt) {
    const forwardKey = (this.keys.has("w") || this.keys.has("arrowup") ? 1 : 0) -
      (this.keys.has("s") || this.keys.has("arrowdown") ? 1 : 0);
    // Deliberately inverted lateral controls: A moves right, D moves left.
const lateralKey = (this.keys.has("d") ? 1 : 0) -
  (this.keys.has("a") ? 1 : 0) +
  (this.keys.has("arrowleft") ? 1 : 0) -
  (this.keys.has("arrowright") ? 1 : 0);

    let forward = forwardKey - this.joystickInput.y;
    let lateral = lateralKey + this.joystickInput.x;
    const magnitude = Math.hypot(forward, lateral);
    this.isMoving = magnitude > 0.05;
    if (magnitude > 1) { forward /= magnitude; lateral /= magnitude; }

    if (magnitude > 0.001) {
      const speed = this.moveSpeed * (this.keys.has("shift") ? this.sprintMultiplier : 1);
      const sin = Math.sin(this.yaw);
      const cos = Math.cos(this.yaw);
      // Match the camera's actual forward/right vectors. With yaw 0,
      // forward is -Z and right is +X. Keep the intentional A/D inversion.
      // This makes movement follow the view after turning left or right.
      this.camera.position.x += (-sin * forward + cos * lateral) * speed * dt;
      this.camera.position.z += (-cos * forward - sin * lateral) * speed * dt;
    }

    this.camera.position.y = terrainHeight(this.camera.position.x, this.camera.position.z) + this.eyeHeight;
  }

  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    window.removeEventListener("keydown", this.onKeyDown);
    window.removeEventListener("keyup", this.onKeyUp);
    window.removeEventListener("blur", this.onBlur);
    document.removeEventListener("visibilitychange", this.onVisibilityChange);
    document.removeEventListener("mousemove", this.onMouseMove);
    document.removeEventListener("pointerlockchange", this.onPointerLockChange);
    this.canvas.removeEventListener("click", this.onCanvasClick);
    this.canvas.removeEventListener("pointerdown", this.onCanvasDragStart);
    this.canvas.removeEventListener("pointermove", this.onCanvasDragMove);
    this.canvas.removeEventListener("pointerup", this.onCanvasDragEnd);
    this.canvas.removeEventListener("pointercancel", this.onCanvasDragEnd);
    if (this.joystick) {
      this.joystick.removeEventListener("pointerdown", this.onJoystickDown);
      this.joystick.removeEventListener("pointermove", this.onJoystickMove);
      this.joystick.removeEventListener("pointerup", this.onJoystickEnd);
      this.joystick.removeEventListener("pointercancel", this.onJoystickEnd);
    }
    if (this.lookZone) {
      this.lookZone.removeEventListener("pointerdown", this.onLookDown);
      this.lookZone.removeEventListener("pointermove", this.onLookMove);
      this.lookZone.removeEventListener("pointerup", this.onLookEnd);
      this.lookZone.removeEventListener("pointercancel", this.onLookEnd);
    }
    if (document.pointerLockElement === this.canvas) document.exitPointerLock?.();
  }
}
