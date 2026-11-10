"use client";

import { useEffect, useRef } from "react";
import type { Mesh, MeshBasicMaterial, PlaneGeometry, Texture } from "three";

const SPHERE_RADIUS = 3.1;
const CARD_COUNT = 400;
const CARD_SIZE = 0.26;
const GROUP_SCALE = 1.15;
const ROTATION_SPEED = 0.06;
const ENTRANCE_STAGGER = 0.55;
const ENTRANCE_DURATION = 0.55;
const ENTRANCE_LIFT = 0.2;
const PHOTO_COUNT = 89;

const globePhotoSources = Array.from(
  { length: PHOTO_COUNT },
  (_, index) => `/landing/globe/photo-${String(index).padStart(2, "0")}.avif`,
);

function globeProjectionDiameter(width: number, height: number) {
  const worldRadius = SPHERE_RADIUS * GROUP_SCALE;
  const projectionDepth = Math.sqrt(12 ** 2 - worldRadius ** 2);
  const sourceDiameter = (height * worldRadius) / (projectionDepth * Math.tan((38 * Math.PI) / 360));
  return Math.min(sourceDiameter, width * 0.86, height * 0.86);
}

function seededRandom(seed: number) {
  let value = seed;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

export function PhotoGlobe({ reducedMotion = false }: { reducedMotion?: boolean }) {
  const container = useRef<HTMLDivElement>(null);
  const reduceMotion = useRef(reducedMotion);
  const invalidate = useRef<() => void>(() => {});

  useEffect(() => {
    reduceMotion.current = reducedMotion;
    invalidate.current();
  }, [reducedMotion]);

  useEffect(() => {
    const host = container.current;
    if (!host) return;
    host.dataset.state = "loading";
    let disposed = false;
    let disposeScene = () => {};

    async function initialise() {
      const THREE = await import("three");
      if (disposed) return;

      let renderer: InstanceType<typeof THREE.WebGLRenderer>;
      try {
        renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, powerPreference: "low-power" });
      } catch {
        host!.dataset.state = "unavailable";
        return;
      }
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.NoToneMapping;
      renderer.setClearColor(0x000000, 0);
      renderer.domElement.className =
        "block size-full opacity-0 transition-opacity duration-[420ms] ease-[cubic-bezier(0.22,1,0.36,1)] group-data-[state=ready]:opacity-100 motion-reduce:transition-none";
      renderer.domElement.setAttribute("aria-hidden", "true");
      host!.appendChild(renderer.domElement);

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 100);
      camera.position.set(0, 0, 12);
      const group = new THREE.Group();
      group.scale.setScalar(GROUP_SCALE);
      scene.add(group);
      const geometry = new THREE.PlaneGeometry(1, 1);
      const textures: Texture[] = [];
      const materials: MeshBasicMaterial[] = [];
      const cards: {
        mesh: Mesh<PlaneGeometry, MeshBasicMaterial>;
        position: InstanceType<typeof THREE.Vector3>;
        normal: InstanceType<typeof THREE.Vector3>;
        size: number;
        delay: number;
        hover: number;
      }[] = [];
      const worldPoint = new THREE.Vector3();
      const projectedPoint = new THREE.Vector3();
      const pointer = new THREE.Vector2();
      const origin = new THREE.Vector3();
      const up = new THREE.Vector3(0, 1, 0);
      const orientation = new THREE.Matrix4();
      const finePointer = window.matchMedia("(hover: hover) and (pointer: fine)");
      let frame = 0;
      let previousTime: number | null = null;
      let elapsed = 0;
      let entranceStart: number | null = null;
      let visible = false;
      let contextLost = false;
      let loaded = false;
      let pointerActive = false;

      function stop() {
        if (frame) cancelAnimationFrame(frame);
        frame = 0;
        previousTime = null;
      }

      function canRender() {
        return !disposed && !contextLost && loaded && visible && document.visibilityState === "visible";
      }

      function schedule() {
        if (!canRender()) {
          stop();
          return;
        }
        if (!frame) frame = requestAnimationFrame(render);
      }

      function render(time: number) {
        frame = 0;
        if (!canRender()) {
          stop();
          return;
        }
        const delta = previousTime === null ? 0 : Math.min((time - previousTime) / 1000, 0.05);
        previousTime = time;
        if (!reduceMotion.current) elapsed += delta;
        group.rotation.set(0.2, -0.85 + elapsed * ROTATION_SPEED, 0.05);
        group.updateMatrixWorld(true);

        if (entranceStart === null) {
          entranceStart = elapsed;
          const ordered = cards
            .map((card) => {
              worldPoint.copy(card.position).applyMatrix4(group.matrixWorld);
              return { card, depth: worldPoint.z };
            })
            .sort((a, b) => a.depth - b.depth);
          ordered.forEach(({ card }, index) => {
            card.delay = (index / Math.max(1, ordered.length - 1)) * ENTRANCE_STAGGER;
          });
        }

        if (reduceMotion.current) entranceStart = elapsed - ENTRANCE_STAGGER - ENTRANCE_DURATION;
        const entranceAge = elapsed - entranceStart;
        const entranceFinished = reduceMotion.current || entranceAge >= ENTRANCE_STAGGER + ENTRANCE_DURATION;
        const hoverAllowed =
          entranceFinished && pointerActive && finePointer.matches && !reduceMotion.current;
        const hoverEase = 1 - Math.exp(-12 * delta);
        for (const card of cards) {
          worldPoint.copy(card.position).applyMatrix4(group.matrixWorld);

          // Shrinking front and rear cards leaves a quiet centre for the headline.
          const horizontalDepth = Math.exp(-(((worldPoint.x - 4) / 32.2) ** 2));
          const cameraDepth = Math.exp(-((worldPoint.z / 1.5) ** 2));
          const depthScale = 0.1 + 1.3 * horizontalDepth * cameraDepth;

          let hoverTarget = 0;
          if (hoverAllowed) {
            projectedPoint.copy(worldPoint).project(camera);
            if (projectedPoint.z <= 1) {
              const proximity = Math.max(
                0,
                1 - Math.hypot(projectedPoint.x - pointer.x, projectedPoint.y - pointer.y) / 0.25,
              );
              hoverTarget = proximity * proximity * (3 - 2 * proximity);
            }
          }
          card.hover = reduceMotion.current ? 0 : card.hover + (hoverTarget - card.hover) * hoverEase;
          let entranceLift = 0;
          if (!entranceFinished) {
            const progress = Math.max(0, Math.min(1, (entranceAge - card.delay) / ENTRANCE_DURATION));
            entranceLift = ENTRANCE_LIFT * (1 - progress) ** 3;
          }
          card.mesh.position
            .copy(card.position)
            .addScaledVector(card.normal, entranceLift + card.hover * 0.35);
          card.mesh.scale.setScalar(card.size * depthScale * (1 + card.hover * 0.25));
        }

        renderer.render(scene, camera);
        host!.dataset.state = "ready";
        if (!reduceMotion.current) schedule();
        else previousTime = null;
      }

      function resize() {
        const width = host!.clientWidth;
        const height = host!.clientHeight;
        if (width <= 0 || height <= 0) return;
        renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        const projectedDiameter = globeProjectionDiameter(width, height);
        const worldRadius = SPHERE_RADIUS * GROUP_SCALE;
        const projectionDepth = Math.sqrt(camera.position.z ** 2 - worldRadius ** 2);
        camera.fov =
          (2 * Math.atan((height * worldRadius) / (projectedDiameter * projectionDepth)) * 180) / Math.PI;
        camera.updateProjectionMatrix();
        schedule();
      }

      function pointerMove(event: PointerEvent) {
        if (!finePointer.matches || reduceMotion.current || !visible) {
          pointerActive = false;
          return;
        }
        const rect = host!.getBoundingClientRect();
        if (rect.width <= 0 || rect.height <= 0) return;
        pointer.set(
          ((event.clientX - rect.left) / rect.width) * 2 - 1,
          -(((event.clientY - rect.top) / rect.height) * 2 - 1),
        );
        pointerActive = Math.abs(pointer.x) <= 1 && Math.abs(pointer.y) <= 1;
      }

      function clearPointer() {
        pointerActive = false;
      }

      function visibilityChange() {
        clearPointer();
        schedule();
      }

      function loseContext(event: Event) {
        event.preventDefault();
        contextLost = true;
        host!.dataset.state = "loading";
        stop();
      }

      function restoreContext() {
        contextLost = false;
        for (const texture of textures) texture.needsUpdate = true;
        resize();
      }

      const observer = new IntersectionObserver(
        ([entry]) => {
          visible = entry.isIntersecting;
          if (!visible) clearPointer();
          schedule();
        },
        { threshold: 0 },
      );
      const resizeObserver = new ResizeObserver(resize);
      observer.observe(host!);
      resizeObserver.observe(host!);
      window.addEventListener("resize", resize);
      window.addEventListener("pointermove", pointerMove, { passive: true });
      window.addEventListener("blur", clearPointer);
      document.addEventListener("visibilitychange", visibilityChange);
      renderer.domElement.addEventListener("webglcontextlost", loseContext);
      renderer.domElement.addEventListener("webglcontextrestored", restoreContext);
      invalidate.current = schedule;
      disposeScene = () => {
        stop();
        observer.disconnect();
        resizeObserver.disconnect();
        window.removeEventListener("resize", resize);
        window.removeEventListener("pointermove", pointerMove);
        window.removeEventListener("blur", clearPointer);
        document.removeEventListener("visibilitychange", visibilityChange);
        renderer.domElement.removeEventListener("webglcontextlost", loseContext);
        renderer.domElement.removeEventListener("webglcontextrestored", restoreContext);
        for (const material of materials) material.dispose();
        for (const texture of textures) texture.dispose();
        geometry.dispose();
        renderer.dispose();
        renderer.domElement.remove();
        invalidate.current = () => {};
      };

      const loader = new THREE.TextureLoader();
      const loadedTextures = await Promise.all(
        globePhotoSources.map(async (url) => {
          try {
            const texture = await loader.loadAsync(url);
            if (disposed) {
              texture.dispose();
              return null;
            }
            texture.colorSpace = THREE.SRGBColorSpace;
            texture.anisotropy = Math.min(renderer.capabilities.getMaxAnisotropy(), 4);
            textures.push(texture);
            return texture;
          } catch {
            return null;
          }
        }),
      );
      if (disposed) return;

      const available = loadedTextures.filter(
        (texture): texture is Texture<HTMLImageElement> => texture !== null,
      );
      if (!available.length) {
        host!.dataset.state = "unavailable";
        return;
      }
      for (const texture of available) {
        materials.push(
          new THREE.MeshBasicMaterial({
            map: texture,
            side: THREE.DoubleSide,
            transparent: true,
            alphaTest: 0.01,
            toneMapped: false,
          }),
        );
      }

      const randomSize = seededRandom(143);
      const goldenAngle = Math.PI * (3 - Math.sqrt(5));
      for (let index = 0; index < CARD_COUNT; index++) {
        const height = 1 - (index / (CARD_COUNT - 1)) * 2;
        const ringRadius = Math.sqrt(1 - height * height);
        const angle = goldenAngle * index;
        const position = new THREE.Vector3(
          Math.cos(angle) * ringRadius,
          height,
          Math.sin(angle) * ringRadius,
        ).multiplyScalar(SPHERE_RADIUS);
        const normal = position.clone().normalize();
        const mesh = new THREE.Mesh(geometry, materials[index % materials.length]);
        mesh.position.copy(position);
        orientation.lookAt(origin, normal, up);
        mesh.quaternion.setFromRotationMatrix(orientation);
        group.add(mesh);
        cards.push({
          mesh,
          position,
          normal,
          size: CARD_SIZE * (randomSize() < 0.7 ? 1 : 0.7),
          delay: 0,
          hover: 0,
        });
      }
      loaded = true;
      resize();
      schedule();
    }

    initialise().catch(() => {
      if (!disposed) {
        disposeScene();
        host.dataset.state = "unavailable";
      }
    });
    return () => {
      disposed = true;
      disposeScene();
    };
  }, []);

  return (
    <div
      ref={container}
      className="group pointer-events-none absolute inset-0"
      data-state="loading"
      aria-hidden="true"
    />
  );
}
