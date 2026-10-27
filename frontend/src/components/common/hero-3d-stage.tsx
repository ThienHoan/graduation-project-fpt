"use client";

import React, { useEffect, useRef, useState, useCallback } from "react";
import * as THREE from "three";
import { Sparkles, RotateCw, Eye, ShieldCheck, Cpu, Layers, Maximize2, Compass } from "lucide-react";
import { playWoodTap, playHoverTick, playRoyalChime } from "@/lib/sound-fx";

export type ArtifactMode = "seal" | "lotus" | "ribbon";

interface Hero3DStageProps {
  className?: string;
}

/**
 * Hero3DStage — Vũ Đài 3D Di Sản Tương Tác Trực Tiếp Chuẩn XimiTech & Scroll-Craft
 * 
 * Đưa 3D ra trung tâm thị giác (Hero Centerpiece):
 * - Cho phép người dùng trực tiếp kéo chuột / chạm vuốt để xoay 360 độ (Drag-to-Orbit).
 * - Đèn Spotlight theo sát con trỏ chuột, tạo phản xạ kim loại lấp lánh thời gian thực trên PBR Material.
 * - Cho phép chuyển đổi 3 Bảo Vật Hoàng Gia:
 *   1. Kim Ấn Bát Giác & Ngọc Bích (Imperial Royal Seal)
 *   2. Đóa Sen Vàng Di Sản (Gilded Heritage Lotus)
 *   3. Dải Lụa Sóng Tơ Tằm Sóng Đôi (Cloth Waves)
 * - Các thẻ thông số Telemetry HUD kính mờ sơn mài nổi bật.
 */
export function Hero3DStage({ className = "" }: Hero3DStageProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [activeMode, setActiveMode] = useState<ArtifactMode>("seal");
  const [isDragging, setIsDragging] = useState(false);
  const [autoRotate, setAutoRotate] = useState(true);

  // References to Three.js internal objects
  const sceneRef = useRef<THREE.Scene | null>(null);
  const artifactGroupRef = useRef<THREE.Group | null>(null);
  const cursorLightRef = useRef<THREE.PointLight | null>(null);
  const modeRef = useRef<ArtifactMode>("seal");
  modeRef.current = activeMode;

  const handleModeChange = useCallback((mode: ArtifactMode) => {
    playRoyalChime();
    setActiveMode(mode);
  }, []);

  useEffect(() => {
    if (typeof window === "undefined") return;

    const container = containerRef.current;
    if (!container) return;

    const width = container.clientWidth || 500;
    const height = container.clientHeight || 500;

    // 1. Scene & Camera
    const scene = new THREE.Scene();
    sceneRef.current = scene;

    const camera = new THREE.PerspectiveCamera(46, width / height, 0.1, 1000);
    camera.position.set(0, 4, 48);

    // 2. Renderer
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({
        alpha: true,
        antialias: true,
        powerPreference: "high-performance",
      });
    } catch {
      return;
    }

    renderer.setSize(width, height);
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.25;
    container.appendChild(renderer.domElement);

    // 3. Lighting Rig
    const ambientLight = new THREE.AmbientLight(0xfff7ed, 1.2);
    scene.add(ambientLight);

    const keyLight = new THREE.DirectionalLight(0xf59e0b, 2.8);
    keyLight.position.set(30, 40, 35);
    scene.add(keyLight);

    const rimLight = new THREE.DirectionalLight(0x06b6d4, 1.8);
    rimLight.position.set(-35, -20, -25);
    scene.add(rimLight);

    // Đèn theo trỏ chuột (Cursor Spot Glow)
    const cursorLight = new THREE.PointLight(0xfde68a, 4.2, 80, 1.4);
    cursorLight.position.set(0, 0, 25);
    scene.add(cursorLight);
    cursorLightRef.current = cursorLight;

    // 4. Artifact Container Group
    const artifactGroup = new THREE.Group();
    scene.add(artifactGroup);
    artifactGroupRef.current = artifactGroup;

    // PBR Materials
    const goldMaterial = new THREE.MeshStandardMaterial({
      color: 0xf59e0b,
      metalness: 0.9,
      roughness: 0.18,
      emissive: 0x92400e,
      emissiveIntensity: 0.15,
    });

    const jadeMaterial = new THREE.MeshStandardMaterial({
      color: 0x059669,
      metalness: 0.35,
      roughness: 0.15,
      emissive: 0x064e3b,
      emissiveIntensity: 0.28,
    });

    const rubyMaterial = new THREE.MeshStandardMaterial({
      color: 0xe11d48,
      metalness: 0.45,
      roughness: 0.2,
      emissive: 0x881337,
      emissiveIntensity: 0.3,
    });

    // Sub-groups for the 3 modes
    const sealSubGroup = new THREE.Group();
    const lotusSubGroup = new THREE.Group();
    const ribbonSubGroup = new THREE.Group();

    artifactGroup.add(sealSubGroup);
    artifactGroup.add(lotusSubGroup);
    artifactGroup.add(ribbonSubGroup);

    // BUILD MODE 1: Kim Ấn Hoàng Triều (Imperial Seal)
    {
      // Đế Ấn Bát Giác
      const sealBaseGeo = new THREE.CylinderGeometry(8.5, 9.8, 3.2, 8);
      const sealBase = new THREE.Mesh(sealBaseGeo, goldMaterial);
      sealBase.position.y = -2;
      sealSubGroup.add(sealBase);

      // Thân Ngọc Bích
      const sealBodyGeo = new THREE.CylinderGeometry(7, 7.8, 4.5, 8);
      const sealBody = new THREE.Mesh(sealBodyGeo, jadeMaterial);
      sealBody.position.y = 1.8;
      sealSubGroup.add(sealBody);

      // Núm Rồng Vàng Đỉnh Ấn (Dragon Finial Top)
      const sealCrownGeo = new THREE.OctahedronGeometry(3.6, 2);
      const sealCrown = new THREE.Mesh(sealCrownGeo, goldMaterial);
      sealCrown.position.y = 5.8;
      sealCrown.scale.set(1, 1.3, 1);
      sealSubGroup.add(sealCrown);

      // Vành Nhật Nguyệt Quay Đồng Tâm (Concentric Orbit Rings)
      const ring1Geo = new THREE.TorusGeometry(15, 0.35, 16, 64);
      const ring1 = new THREE.Mesh(ring1Geo, goldMaterial);
      ring1.rotation.x = Math.PI / 3;
      sealSubGroup.add(ring1);

      const ring2Geo = new THREE.TorusGeometry(12.5, 0.25, 12, 48);
      const ring2 = new THREE.Mesh(ring2Geo, rubyMaterial);
      ring2.rotation.y = Math.PI / 4;
      ring2.rotation.z = Math.PI / 5;
      sealSubGroup.add(ring2);

      // Tinh tú bay hộ vệ
      for (let i = 0; i < 8; i++) {
        const satGeo = new THREE.SphereGeometry(0.55, 12, 12);
        const satMesh = new THREE.Mesh(satGeo, goldMaterial);
        const angle = (i / 8) * Math.PI * 2;
        satMesh.position.set(Math.cos(angle) * 16.5, Math.sin(angle) * 3, Math.sin(angle) * 16.5);
        sealSubGroup.add(satMesh);
      }
    }

    // BUILD MODE 2: Đóa Sen Vàng Hoàng Cung (Gilded Lotus)
    {
      const centerGeo = new THREE.SphereGeometry(2.5, 24, 24);
      const centerMesh = new THREE.Mesh(centerGeo, rubyMaterial);
      lotusSubGroup.add(centerMesh);

      const petalCount = 12;
      for (let i = 0; i < petalCount; i++) {
        const petalGeo = new THREE.ConeGeometry(2.2, 8.5, 5);
        const petalMesh = new THREE.Mesh(petalGeo, i % 2 === 0 ? goldMaterial : jadeMaterial);
        const angle = (i / petalCount) * Math.PI * 2;
        petalMesh.position.set(Math.cos(angle) * 4.5, -0.5, Math.sin(angle) * 4.5);
        petalMesh.rotation.z = Math.sin(angle) * 0.75;
        petalMesh.rotation.x = Math.cos(angle) * 0.75;
        lotusSubGroup.add(petalMesh);
      }

      const lotusRingGeo = new THREE.TorusGeometry(13, 0.3, 16, 48);
      const lotusRing = new THREE.Mesh(lotusRingGeo, goldMaterial);
      lotusRing.rotation.x = Math.PI / 2.5;
      lotusSubGroup.add(lotusRing);
    }

    // BUILD MODE 3: Dải Lụa Sóng Tơ Tằm (Dual Flowing Silk Ribbon)
    const ribbonGeo = new THREE.PlaneGeometry(36, 18, 48, 24);
    const origRibbonPos = ribbonGeo.attributes.position.clone();
    const ribbonMat = new THREE.MeshBasicMaterial({
      color: 0xf59e0b,
      wireframe: true,
      transparent: true,
      opacity: 0.6,
      blending: THREE.AdditiveBlending,
    });
    const ribbonMesh = new THREE.Mesh(ribbonGeo, ribbonMat);
    ribbonMesh.rotation.x = -Math.PI / 4;
    ribbonSubGroup.add(ribbonMesh);

    // 5. Cụm Hạt Bụi Vàng Phát Sáng (Gilded Stardust)
    const pCount = 100;
    const pGeo = new THREE.BufferGeometry();
    const pPos = new Float32Array(pCount * 3);
    for (let i = 0; i < pCount; i++) {
      pPos[i * 3] = (Math.random() - 0.5) * 55;
      pPos[i * 3 + 1] = (Math.random() - 0.5) * 45;
      pPos[i * 3 + 2] = (Math.random() - 0.5) * 35;
    }
    pGeo.setAttribute("position", new THREE.BufferAttribute(pPos, 3));

    const pCanvas = document.createElement("canvas");
    pCanvas.width = 32;
    pCanvas.height = 32;
    const pCtx = pCanvas.getContext("2d");
    if (pCtx) {
      const grad = pCtx.createRadialGradient(16, 16, 0, 16, 16, 16);
      grad.addColorStop(0, "rgba(253, 224, 71, 1)");
      grad.addColorStop(0.4, "rgba(245, 158, 11, 0.8)");
      grad.addColorStop(1, "rgba(0, 0, 0, 0)");
      pCtx.fillStyle = grad;
      pCtx.beginPath();
      pCtx.arc(16, 16, 16, 0, Math.PI * 2);
      pCtx.fill();
    }
    const pTexture = new THREE.CanvasTexture(pCanvas);
    const pMat = new THREE.PointsMaterial({
      size: 2.2,
      map: pTexture,
      transparent: true,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const particles = new THREE.Points(pGeo, pMat);
    scene.add(particles);

    // 6. Interactive Drag & Pointer Tracking
    let targetRotY = 0;
    let targetRotX = 0;
    let curRotY = 0;
    let curRotX = 0;
    let isUserDragging = false;
    let lastPointerX = 0;
    let lastPointerY = 0;

    const onPointerDown = (e: PointerEvent) => {
      isUserDragging = true;
      setIsDragging(true);
      lastPointerX = e.clientX;
      lastPointerY = e.clientY;
      (e.target as HTMLElement)?.setPointerCapture?.(e.pointerId);
    };

    const onPointerMove = (e: PointerEvent) => {
      const rect = container.getBoundingClientRect();
      const nx = (e.clientX - rect.left) / rect.width - 0.5;
      const ny = (e.clientY - rect.top) / rect.height - 0.5;

      // Update cursor light
      if (cursorLightRef.current) {
        cursorLightRef.current.position.x = nx * 35;
        cursorLightRef.current.position.y = -ny * 35;
      }

      if (isUserDragging) {
        const dx = e.clientX - lastPointerX;
        const dy = e.clientY - lastPointerY;
        lastPointerX = e.clientX;
        lastPointerY = e.clientY;

        targetRotY += dx * 0.012;
        targetRotX += dy * 0.012;
      } else {
        // Gentle tilt parallax
        targetRotY += nx * 0.002;
        targetRotX += ny * 0.002;
      }
    };

    const onPointerUp = (e: PointerEvent) => {
      isUserDragging = false;
      setIsDragging(false);
      (e.target as HTMLElement)?.releasePointerCapture?.(e.pointerId);
    };

    container.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("pointermove", onPointerMove);
    window.addEventListener("pointerup", onPointerUp);

    // 7. Animation Loop
    let animId: number;
    const clock = new THREE.Clock();

    const animate = () => {
      animId = requestAnimationFrame(animate);
      const time = clock.getElapsedTime();

      // Show/hide sub-groups based on active mode
      const currentMode = modeRef.current;
      sealSubGroup.visible = currentMode === "seal";
      lotusSubGroup.visible = currentMode === "lotus";
      ribbonSubGroup.visible = currentMode === "ribbon";

      // Auto-rotation when not dragging
      if (!isUserDragging) {
        targetRotY += 0.008;
      }

      // Smooth interpolation
      curRotY += (targetRotY - curRotY) * 0.08;
      curRotX += (targetRotX - curRotX) * 0.08;

      artifactGroup.rotation.y = curRotY;
      artifactGroup.rotation.x = Math.max(-0.5, Math.min(0.5, curRotX));

      // Wave physics for Ribbon mode
      if (currentMode === "ribbon") {
        const posAttr = ribbonGeo.attributes.position as THREE.BufferAttribute;
        const posArr = posAttr.array as Float32Array;
        const origArr = origRibbonPos.array as Float32Array;
        for (let i = 0; i < posArr.length; i += 3) {
          const u = origArr[i] * 0.18;
          const v = origArr[i + 1] * 0.22;
          posArr[i + 2] = origArr[i + 2] + Math.sin(u + time * 1.5) * 2.8 + Math.cos(v + time * 1.2) * 1.8;
        }
        posAttr.needsUpdate = true;
      }

      // Stardust float
      particles.rotation.y = time * 0.04;
      particles.rotation.x = Math.sin(time * 0.03) * 0.05;

      renderer.render(scene, camera);
    };

    animate();

    // 8. Resize Handler
    const onResize = () => {
      if (!container) return;
      const w = container.clientWidth;
      const h = container.clientHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    };
    window.addEventListener("resize", onResize);

    // 9. Cleanup
    return () => {
      cancelAnimationFrame(animId);
      container.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("pointermove", onPointerMove);
      window.removeEventListener("pointerup", onPointerUp);
      window.removeEventListener("resize", onResize);

      if (renderer.domElement && container.contains(renderer.domElement)) {
        container.removeChild(renderer.domElement);
      }
      goldMaterial.dispose();
      jadeMaterial.dispose();
      rubyMaterial.dispose();
      ribbonMat.dispose();
      ribbonGeo.dispose();
      pMat.dispose();
      pGeo.dispose();
      pTexture.dispose();
      renderer.dispose();
    };
  }, []);

  return (
    <div className={`relative flex flex-col items-center justify-center ${className}`}>
      {/* 3D Canvas Viewport Box với viền kính mờ & quầng sáng vàng son */}
      <div className="relative aspect-square w-full max-w-[460px] overflow-hidden rounded-3xl border border-amber-400/30 bg-gradient-to-b from-white/[0.08] via-black/40 to-black/80 shadow-[0_0_50px_rgba(245,158,11,0.2)] backdrop-blur-2xl">
        {/* Lớp hiển thị 3D Three.js */}
        <div
          ref={containerRef}
          className={`h-full w-full cursor-grab active:cursor-grabbing touch-none ${
            isDragging ? "cursor-grabbing" : ""
          }`}
          title="Kéo chuột hoặc vuốt để xoay 360 độ"
        />

        {/* Floating Telemetry Badge 1: Top-Left */}
        <div className="pointer-events-none absolute left-4 top-4 z-20 flex items-center gap-2 rounded-full border border-amber-400/30 bg-black/75 px-3 py-1.5 text-[11px] font-semibold text-amber-300 backdrop-blur-md">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
          </span>
          <span>Bảo Vật 3D Khảo Chứng</span>
        </div>

        {/* Floating Telemetry Badge 2: Top-Right Drag Hint */}
        <div className="pointer-events-none absolute right-4 top-4 z-20 flex items-center gap-1.5 rounded-full border border-white/15 bg-black/60 px-2.5 py-1 text-[10px] text-stone-300 backdrop-blur-md">
          <RotateCw className="h-3 w-3 animate-spin-slow text-amber-400" />
          <span>Kéo xoay 360°</span>
        </div>

        {/* Floating Telemetry HUD: Bottom-Left Material Specs */}
        <div className="pointer-events-none absolute bottom-4 left-4 z-20 max-w-[200px] rounded-xl border border-white/10 bg-black/75 p-2.5 text-[11px] backdrop-blur-md">
          <div className="font-semibold text-amber-200">
            {activeMode === "seal" && "Kim Ấn Hoàng Triều"}
            {activeMode === "lotus" && "Đóa Sen Vàng Sa"}
            {activeMode === "ribbon" && "Lụa Gấm Tơ Tằm"}
          </div>
          <div className="mt-0.5 text-[10px] text-stone-400">
            {activeMode === "seal" && "Chế tác vàng ròng & ngọc bích Khâm Định."}
            {activeMode === "lotus" && "Hoa văn liên hoa quốc sắc Đại Việt."}
            {activeMode === "ribbon" && "Mô phỏng động lực học sóng tơ tằm."}
          </div>
        </div>

        {/* Interactive Mode Switcher: Bottom-Right */}
        <div className="absolute bottom-4 right-4 z-20 flex items-center gap-1 rounded-xl border border-white/15 bg-black/80 p-1 backdrop-blur-md">
          <button
            onClick={() => handleModeChange("seal")}
            className={`rounded-lg px-2 py-1 text-[11px] font-bold transition-all ${
              activeMode === "seal"
                ? "bg-amber-400 text-stone-950 shadow-xs"
                : "text-stone-300 hover:text-amber-200"
            }`}
            title="Kim Ấn Bát Giác"
          >
            Ấn Vàng
          </button>
          <button
            onClick={() => handleModeChange("lotus")}
            className={`rounded-lg px-2 py-1 text-[11px] font-bold transition-all ${
              activeMode === "lotus"
                ? "bg-amber-400 text-stone-950 shadow-xs"
                : "text-stone-300 hover:text-amber-200"
            }`}
            title="Hoa Sen Vàng"
          >
            Hoa Sen
          </button>
          <button
            onClick={() => handleModeChange("ribbon")}
            className={`rounded-lg px-2 py-1 text-[11px] font-bold transition-all ${
              activeMode === "ribbon"
                ? "bg-amber-400 text-stone-950 shadow-xs"
                : "text-stone-300 hover:text-amber-200"
            }`}
            title="Dải Lụa Sóng"
          >
            Dải Lụa
          </button>
        </div>
      </div>

      {/* Dòng ghi chú tương tác */}
      <div className="mt-3 flex items-center gap-3 text-xs text-stone-400">
        <span className="flex items-center gap-1 text-amber-300/80">
          <Sparkles className="h-3.5 w-3.5 text-amber-400" />
          <span>Three.js PBR 120fps</span>
        </span>
        <span>•</span>
        <span>Chạm vuốt để tương tác đa chiều</span>
      </div>
    </div>
  );
}
