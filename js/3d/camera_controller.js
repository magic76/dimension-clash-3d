/**
 * 跨次元大亂鬥 (Dimension Clash Online) - 3D 視角控制器
 * 支援三大核心視角：第三人稱、第一人稱、上方俯瞰。
 *
 * 2026-09 control pass:
 * - Third-person battle lock-on camera no longer depends on player mesh rotation.
 * - Exposes a true world-space camera yaw for camera-relative player movement.
 * - Adds frame-rate independent camera damping and gentle auto re-centering.
 * - Installs safer mobile pointer controls so action touches do not cancel the joystick.
 */

class CameraController3D {
  constructor(camera, domElement) {
    this.camera = camera;
    this.domElement = domElement;

    // View Modes: "third_person", "first_person", "top_down"
    this.mode = "third_person";
    this.target = null;
    this.opponent = null;

    // `yaw` is intentionally the actual ground-plane camera forward heading.
    // App3D passes this value into Fighter3D.move3D().
    this.yaw = 0;
    this.orbitYaw = 0;
    this.manualYawOffset = 0;
    this.pitch = 0.28;
    this.distance = 15;
    this.smoothDistance = this.distance;

    this.isDragging = false;
    this.dragPointerId = null;
    this.previousPointerPosition = { x: 0, y: 0 };

    this.smoothPosition = new THREE.Vector3(0, 15, 25);
    this.smoothLookAt = new THREE.Vector3(0, 2, 0);

    this.setupInputListeners();
  }

  normalizeAngle(angle) {
    return Math.atan2(Math.sin(angle), Math.cos(angle));
  }

  dampAngle(current, target, lambda, dt) {
    const delta = this.normalizeAngle(target - current);
    const alpha = 1 - Math.exp(-lambda * Math.max(0, dt || 0));
    return this.normalizeAngle(current + delta * alpha);
  }

  dampValue(current, target, lambda, dt) {
    const alpha = 1 - Math.exp(-lambda * Math.max(0, dt || 0));
    return current + (target - current) * alpha;
  }

  syncMovementYaw(cameraPos, lookAt) {
    const dx = lookAt.x - cameraPos.x;
    const dz = lookAt.z - cameraPos.z;
    if ((dx * dx + dz * dz) > 0.0001) {
      this.yaw = Math.atan2(dx, dz);
    }
  }

  setupInputListeners() {
    if (!this.domElement) return;

    // Pointer Events keep mouse/touch camera input on one code path and do not
    // interfere with the virtual joystick overlay.
    this.domElement.style.touchAction = "none";

    this.domElement.addEventListener("pointerdown", (e) => {
      if (e.pointerType === "mouse" && e.button !== 0) return;

      this.isDragging = true;
      this.dragPointerId = e.pointerId;
      this.previousPointerPosition = { x: e.clientX, y: e.clientY };

      if (this.domElement.setPointerCapture) {
        try { this.domElement.setPointerCapture(e.pointerId); } catch (_) {}
      }
    });

    this.domElement.addEventListener("pointermove", (e) => {
      if (!this.isDragging || e.pointerId !== this.dragPointerId) return;

      const deltaX = e.clientX - this.previousPointerPosition.x;
      const deltaY = e.clientY - this.previousPointerPosition.y;
      const sensitivity = this.mode === "first_person" ? 0.003 : (e.pointerType === "touch" ? 0.004 : 0.0035);

      this.manualYawOffset -= deltaX * sensitivity;
      this.manualYawOffset = this.normalizeAngle(this.manualYawOffset);
      this.pitch -= deltaY * sensitivity;

      if (this.mode === "first_person") {
        this.pitch = Math.max(-Math.PI * 0.35, Math.min(Math.PI * 0.35, this.pitch));
      } else {
        this.pitch = Math.max(0.10, Math.min(Math.PI * 0.38, this.pitch));
      }

      this.previousPointerPosition = { x: e.clientX, y: e.clientY };
    });

    const stopDragging = (e) => {
      if (this.dragPointerId !== null && e.pointerId !== this.dragPointerId) return;
      this.isDragging = false;
      this.dragPointerId = null;
    };

    this.domElement.addEventListener("pointerup", stopDragging);
    this.domElement.addEventListener("pointercancel", stopDragging);
    this.domElement.addEventListener("lostpointercapture", () => {
      this.isDragging = false;
      this.dragPointerId = null;
    });

    // Desktop wheel: small, bounded zoom adjustment for third-person view.
    this.domElement.addEventListener("wheel", (e) => {
      if (this.mode !== "third_person") return;
      e.preventDefault();
      this.distance = Math.max(11, Math.min(22, this.distance + Math.sign(e.deltaY) * 1.2));
    }, { passive: false });
  }

  cycleViewMode() {
    if (this.mode === "third_person") {
      this.setViewMode("first_person");
    } else if (this.mode === "first_person") {
      this.setViewMode("top_down");
    } else {
      this.setViewMode("third_person");
    }
    return this.mode;
  }

  setViewMode(mode) {
    this.mode = mode;
    this.manualYawOffset = 0;

    if (mode === "top_down") {
      this.pitch = Math.PI * 0.48;
    } else if (mode === "first_person") {
      this.pitch = 0;
    } else {
      this.pitch = 0.28;
    }
  }

  getViewModeLabel() {
    switch (this.mode) {
      case "first_person": return "👁️ 第一人稱 (1st Person)";
      case "third_person": return "🎥 戰鬥鎖定視角 (Battle Camera)";
      case "top_down": return "🗺️ 上方俯瞰 (Top-Down)";
      default: return "3D 視角";
    }
  }

  update(dt) {
    if (!this.camera) return;
    const safeDt = Math.min(0.05, Math.max(0.001, dt || 0.016));

    if (!this.target) {
      this.camera.position.set(0, 16, 28);
      this.camera.lookAt(0, 2, 0);
      this.yaw = Math.PI;
      return;
    }

    const targetPos = this.target.position;
    const desiredCameraPos = new THREE.Vector3();
    const desiredLookAt = new THREE.Vector3();

    if (this.mode === "first_person") {
      const eyeHeight = 2.4;
      desiredCameraPos.set(targetPos.x, targetPos.y + eyeHeight, targetPos.z);

      const charAngle = this.target.rotation.y + this.manualYawOffset;
      const lookDir = new THREE.Vector3(
        Math.sin(charAngle) * Math.cos(this.pitch),
        Math.sin(this.pitch),
        Math.cos(charAngle) * Math.cos(this.pitch)
      );
      desiredLookAt.copy(desiredCameraPos).add(lookDir);

      this.camera.position.copy(desiredCameraPos);
      this.camera.lookAt(desiredLookAt);
      this.orbitYaw = charAngle;
      this.syncMovementYaw(desiredCameraPos, desiredLookAt);
      return;
    }

    if (this.mode === "top_down") {
      const midPoint = new THREE.Vector3().copy(targetPos);
      if (this.opponent) {
        midPoint.add(this.opponent.position).multiplyScalar(0.5);
      }

      desiredCameraPos.set(midPoint.x, midPoint.y + 45, midPoint.z + 18);
      desiredLookAt.set(midPoint.x, midPoint.y, midPoint.z);

      const posAlpha = 1 - Math.exp(-8 * safeDt);
      const lookAlpha = 1 - Math.exp(-9 * safeDt);
      this.smoothPosition.lerp(desiredCameraPos, posAlpha);
      this.smoothLookAt.lerp(desiredLookAt, lookAlpha);

      this.camera.position.copy(this.smoothPosition);
      this.camera.lookAt(this.smoothLookAt);
      this.syncMovementYaw(this.smoothPosition, this.smoothLookAt);
      return;
    }

    // ── Third-person battle camera ────────────────────────────────────────
    // Base heading points from the player to the opponent. This is independent
    // from the character mesh rotation, so strafing no longer whips the camera.
    let baseHeading = this.target.rotation.y;
    let fighterDistance = 10;

    if (this.opponent) {
      const dx = this.opponent.position.x - targetPos.x;
      const dz = this.opponent.position.z - targetPos.z;
      const distSq = dx * dx + dz * dz;
      if (distSq > 0.001) {
        baseHeading = Math.atan2(dx, dz);
        fighterDistance = Math.sqrt(distSq);
      }
    }

    // After manual orbit input, gently return behind the combat line instead of
    // snapping immediately back to the opponent.
    if (!this.isDragging) {
      this.manualYawOffset *= Math.exp(-1.8 * safeDt);
      if (Math.abs(this.manualYawOffset) < 0.001) this.manualYawOffset = 0;
    }

    const desiredOrbitYaw = this.normalizeAngle(baseHeading + this.manualYawOffset);
    this.orbitYaw = this.dampAngle(
      this.orbitYaw,
      desiredOrbitYaw,
      this.isDragging ? 16 : 7,
      safeDt
    );

    // Pull back slightly as fighters separate so both remain readable without
    // turning the camera into a distant spectator view.
    const autoDistance = Math.max(12.5, Math.min(20.5, 12.5 + fighterDistance * 0.22));
    const requestedDistance = Math.max(11, Math.min(22, this.distance));
    const desiredDistance = Math.max(requestedDistance, autoDistance);
    this.smoothDistance = this.dampValue(this.smoothDistance, desiredDistance, 6, safeDt);

    const horizontalDist = this.smoothDistance * Math.cos(this.pitch);
    const verticalDist = this.smoothDistance * Math.sin(this.pitch) + 3.0;

    desiredCameraPos.set(
      targetPos.x - Math.sin(this.orbitYaw) * horizontalDist,
      targetPos.y + verticalDist,
      targetPos.z - Math.cos(this.orbitYaw) * horizontalDist
    );

    // Keep the player visually dominant while still framing the opponent.
    desiredLookAt.set(targetPos.x, targetPos.y + 2.1, targetPos.z);
    if (this.opponent) {
      const oppAim = new THREE.Vector3(
        this.opponent.position.x,
        this.opponent.position.y + 2.0,
        this.opponent.position.z
      );
      desiredLookAt.lerp(oppAim, 0.40);
    } else {
      desiredLookAt.x += Math.sin(this.orbitYaw) * 4.5;
      desiredLookAt.z += Math.cos(this.orbitYaw) * 4.5;
    }

    const posAlpha = 1 - Math.exp(-10 * safeDt);
    const lookAlpha = 1 - Math.exp(-12 * safeDt);
    this.smoothPosition.lerp(desiredCameraPos, posAlpha);
    this.smoothLookAt.lerp(desiredLookAt, lookAlpha);

    this.camera.position.copy(this.smoothPosition);
    this.camera.lookAt(this.smoothLookAt);

    // Crucial: movement yaw is derived from what the player actually sees,
    // rather than from character rotation or a raw drag offset.
    this.syncMovementYaw(this.smoothPosition, this.smoothLookAt);
  }
}

/**
 * Install player-control compatibility patches once all scripts have loaded.
 * camera_controller.js is loaded before combat_3d.js/app.js, so DOMContentLoaded
 * lets us patch their prototypes before App3D is instantiated.
 */
function installDimensionClashControlTuning() {
  // ── True camera-relative movement + lock-on strafing for P1 only ────────
  if (window.Fighter3D && !window.Fighter3D.prototype.__cameraRelativeMovementPatched) {
    const originalMove3D = window.Fighter3D.prototype.move3D;

    window.Fighter3D.prototype.move3D = function(moveX, moveZ, cameraYaw = 0) {
      // Preserve the original AI/non-player movement semantics.
      if (!this.isPlayer) {
        return originalMove3D.call(this, moveX, moveZ, cameraYaw);
      }

      if (
        this.state === "hit" ||
        this.state === "dizzy" ||
        this.state === "ko" ||
        this.state === "guard" ||
        this.isCharging
      ) return;

      let inputX = Number.isFinite(moveX) ? moveX : 0;
      let inputZ = Number.isFinite(moveZ) ? moveZ : 0;
      let magnitude = Math.sqrt(inputX * inputX + inputZ * inputZ);

      // Normalize keyboard diagonals. The virtual joystick already supplies an
      // analog magnitude, so preserve that when it is <= 1.
      if (magnitude > 1) {
        inputX /= magnitude;
        inputZ /= magnitude;
        magnitude = 1;
      }

      // App convention is W = moveZ -1. Camera forward is therefore -moveZ.
      const sin = Math.sin(cameraYaw);
      const cos = Math.cos(cameraYaw);
      const worldMoveX = inputX * cos - inputZ * sin;
      const worldMoveZ = -inputX * sin - inputZ * cos;

      const speedMultiplier = this.isFlying ? 1.35 : 1.0;
      const targetVx = worldMoveX * this.baseSpeed * speedMultiplier;
      const targetVz = worldMoveZ * this.baseSpeed * speedMultiplier;

      // A small velocity blend removes the digital on/off feel without adding
      // noticeable input latency. Fighter3D.update() still applies its own drag.
      const response = magnitude > 0.01 ? 0.82 : 0.68;
      this.vx += (targetVx - this.vx) * response;
      this.vz += (targetVz - this.vz) * response;

      if (magnitude > 0.08) {
        const opponent = window.matchEngine3D && window.matchEngine3D.p2Current;
        if (opponent && opponent !== this && opponent.state !== "ko") {
          // Arena fighter behavior: move/strafe independently while keeping the
          // character facing the current opponent.
          this.rotationY = Math.atan2(opponent.x - this.x, opponent.z - this.z);
        } else {
          this.rotationY = Math.atan2(worldMoveX, worldMoveZ);
        }

        if (this.isGrounded && !this.state.startsWith("attack")) {
          this.state = "run";
        }
      } else if (this.isGrounded && this.state === "run") {
        this.state = "idle";
      }
    };

    window.Fighter3D.prototype.__cameraRelativeMovementPatched = true;
  }

  // ── Pointer-id based mobile joystick/action controls ───────────────────
  if (window.App3D && !window.App3D.prototype.__pointerControlsPatched) {
    window.App3D.prototype.setupTouchControls = function() {
      const joystickArea = document.getElementById("virtualJoystickArea");
      const joystickKnob = document.getElementById("virtualJoystickKnob");

      if (joystickArea && joystickKnob) {
        joystickArea.style.touchAction = "none";
        let joystickPointerId = null;

        const resetJoystick = () => {
          this.joystick.active = false;
          this.joystick.moveX = 0;
          this.joystick.moveY = 0;
          joystickPointerId = null;
          joystickKnob.style.transform = "translate(0px, 0px)";
        };

        const handleJoystick = (clientX, clientY) => {
          const rect = joystickArea.getBoundingClientRect();
          const centerX = rect.left + rect.width / 2;
          const centerY = rect.top + rect.height / 2;
          const maxDist = Math.max(36, Math.min(rect.width, rect.height) * 0.40);

          let dx = clientX - centerX;
          let dy = clientY - centerY;
          let dist = Math.sqrt(dx * dx + dy * dy);

          if (dist > maxDist) {
            dx = (dx / dist) * maxDist;
            dy = (dy / dist) * maxDist;
            dist = maxDist;
          }

          joystickKnob.style.transform = `translate(${dx}px, ${dy}px)`;

          // 12% dead zone + mild response curve: precise around center, still
          // reaches full speed at the rim.
          const nx = dx / maxDist;
          const ny = dy / maxDist;
          const normalizedMagnitude = Math.min(1, Math.sqrt(nx * nx + ny * ny));
          const deadZone = 0.12;

          if (normalizedMagnitude <= deadZone) {
            this.joystick.moveX = 0;
            this.joystick.moveY = 0;
            return;
          }

          const remapped = (normalizedMagnitude - deadZone) / (1 - deadZone);
          const curved = Math.pow(remapped, 1.18);
          const scale = curved / (normalizedMagnitude || 1);
          this.joystick.moveX = nx * scale;
          this.joystick.moveY = ny * scale;
        };

        joystickArea.addEventListener("pointerdown", (e) => {
          if (joystickPointerId !== null) return;
          if (e.pointerType === "mouse" && e.button !== 0) return;

          e.preventDefault();
          joystickPointerId = e.pointerId;
          this.joystick.active = true;

          if (joystickArea.setPointerCapture) {
            try { joystickArea.setPointerCapture(e.pointerId); } catch (_) {}
          }
          handleJoystick(e.clientX, e.clientY);
        });

        joystickArea.addEventListener("pointermove", (e) => {
          if (!this.joystick.active || e.pointerId !== joystickPointerId) return;
          e.preventDefault();
          handleJoystick(e.clientX, e.clientY);
        });

        const releaseJoystick = (e) => {
          if (e.pointerId !== joystickPointerId) return;
          e.preventDefault();
          resetJoystick();
        };

        joystickArea.addEventListener("pointerup", releaseJoystick);
        joystickArea.addEventListener("pointercancel", releaseJoystick);
        joystickArea.addEventListener("lostpointercapture", (e) => {
          if (e.pointerId === joystickPointerId) resetJoystick();
        });
      }

      const bindPointer = (id, onDown, onUp) => {
        const btn = document.getElementById(id);
        if (!btn) return;
        btn.style.touchAction = "none";

        btn.addEventListener("pointerdown", (e) => {
          if (e.pointerType === "mouse" && e.button !== 0) return;
          e.preventDefault();
          if (btn.setPointerCapture) {
            try { btn.setPointerCapture(e.pointerId); } catch (_) {}
          }
          if (onDown) onDown();
        });

        const release = (e) => {
          e.preventDefault();
          if (onUp) onUp();
        };
        btn.addEventListener("pointerup", release);
        btn.addEventListener("pointercancel", release);
      };

      const p1 = () => window.matchEngine3D ? window.matchEngine3D.p1Current : null;
      const p2 = () => window.matchEngine3D ? window.matchEngine3D.p2Current : null;

      bindPointer("touchBtnFlight", () => { const f = p1(); if (f) f.toggleFlight(); });
      bindPointer("touchBtnJump", () => { const f = p1(); if (f) f.jump(); });
      bindPointer("touchBtnRoll", () => { const f = p1(); if (f) f.dodge(); });
      bindPointer("touchBtnGuard", () => { const f = p1(); if (f) f.guard(true); }, () => { const f = p1(); if (f) f.guard(false); });
      bindPointer("touchBtnAtk", () => { const f = p1(); if (f) f.lightAttack(p2()); });
      bindPointer("touchBtnHeavy", () => {
        const fighter = p1();
        if (!fighter) return;
        fighter.startHeavyCharge();
        setTimeout(() => {
          if (p1() === fighter && fighter.isCharging) fighter.releaseHeavyCharge(p2());
        }, 700);
      });
      bindPointer("touchBtnGrab", () => { const f = p1(); if (f) f.grab(p2()); });
      bindPointer("touchBtnSkill1", () => { const f = p1(); if (f) f.useSkill1(p2()); });
      bindPointer("touchBtnSkill2", () => { const f = p1(); if (f) f.useSkill2(p2()); });
      bindPointer("touchBtnUlt", () => { const f = p1(); if (f) f.useUlt(p2()); });
      bindPointer("touchBtnBurst", () => { const f = p1(); if (f) f.useBurst(p2()); });
      bindPointer("touchBtnAssist", () => { if (window.matchEngine3D) window.matchEngine3D.callAssist(); });
    };

    window.App3D.prototype.__pointerControlsPatched = true;
  }
}

if (typeof window !== "undefined") {
  window.CameraController3D = CameraController3D;

  if (document.readyState === "loading") {
    window.addEventListener("DOMContentLoaded", installDimensionClashControlTuning, { once: true });
  } else {
    setTimeout(installDimensionClashControlTuning, 0);
  }
}
