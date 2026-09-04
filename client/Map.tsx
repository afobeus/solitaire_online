import { useEffect, useRef, useState } from "react";
import * as THREE from "three";
import type { Command, Item, MatchView } from "../shared/protocol.js";
import { itemInfo } from "../shared/protocol.js";
import { timeLeft } from "./network.js";

type Send = (command: Command) => void;

const DIRECTIONS: Record<string, "up" | "down" | "left" | "right"> = {
  KeyW: "up", ArrowUp: "up",
  KeyS: "down", ArrowDown: "down",
  KeyA: "left", ArrowLeft: "left",
  KeyD: "right", ArrowRight: "right",
};

const ITEM_COLORS: Record<Item, number> = {
  shuffle: 0xffbd59,
  recon: 0x43c8ff,
  peek: 0xc98cff,
};

const FACING_ANGLE = {
  up: 0,
  down: Math.PI,
  left: Math.PI / 2,
  right: -Math.PI / 2,
} as const;

function positionFor(x: number, y: number, size: number) {
  return new THREE.Vector3(x - (size - 1) / 2, 0, y - (size - 1) / 2);
}

function makeLabel(text: string, color: string) {
  const canvas = document.createElement("canvas");
  canvas.width = 512;
  canvas.height = 96;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "rgba(5, 10, 14, .82)";
  context.roundRect(4, 4, 504, 88, 18);
  context.fill();
  context.strokeStyle = color;
  context.lineWidth = 4;
  context.stroke();
  context.font = "600 32px Inter, Arial";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillStyle = "#f4f9f7";
  context.fillText(text.slice(0, 22), 256, 50);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.SpriteMaterial({ map: texture, transparent: true, depthTest: false });
  const sprite = new THREE.Sprite(material);
  sprite.position.y = 2.25;
  sprite.scale.set(1.55, 0.3, 1);
  return sprite;
}

function makeOperative(own: boolean, name: string) {
  const group = new THREE.Group();
  const accent = own ? 0x5ff2a1 : 0xff5d62;
  const fabric = new THREE.MeshStandardMaterial({ color: own ? 0x19392f : 0x3b2427, roughness: 0.82 });
  const armor = new THREE.MeshStandardMaterial({ color: 0x11191c, metalness: 0.46, roughness: 0.38 });
  const glow = new THREE.MeshStandardMaterial({ color: accent, emissive: accent, emissiveIntensity: 2.2 });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.28, 0.7, 5, 10), fabric);
  body.position.y = 1.05;
  const vest = new THREE.Mesh(new THREE.BoxGeometry(0.58, 0.54, 0.32), armor);
  vest.position.set(0, 1.18, 0.02);
  const head = new THREE.Mesh(new THREE.SphereGeometry(0.22, 14, 10), armor);
  head.position.y = 1.76;
  const visor = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.09, 0.08), glow);
  visor.position.set(0, 1.78, -0.18);
  const weapon = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.12, 0.88), armor);
  weapon.position.set(0.36, 1.12, -0.3);
  weapon.rotation.x = -0.15;
  const legGeometry = new THREE.CapsuleGeometry(0.1, 0.42, 4, 8);
  const leftLeg = new THREE.Mesh(legGeometry, fabric);
  leftLeg.position.set(-0.16, 0.39, 0);
  leftLeg.name = "left-leg";
  const rightLeg = leftLeg.clone();
  rightLeg.position.x = 0.16;
  rightLeg.name = "right-leg";
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.48, 0.035, 8, 40), glow);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.04;
  ring.name = "status-ring";
  group.add(body, vest, head, visor, weapon, leftLeg, rightLeg, ring, makeLabel(own ? "ВЫ" : name, own ? "#58f1a0" : "#ff6469"));
  group.scale.setScalar(0.78);
  group.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
  return group;
}

function makeLoot(item: Item) {
  const group = new THREE.Group();
  const color = ITEM_COLORS[item];
  const material = new THREE.MeshStandardMaterial({ color, emissive: color, emissiveIntensity: 2, metalness: 0.58, roughness: 0.2 });
  const geometry = item === "shuffle"
    ? new THREE.TorusKnotGeometry(0.21, 0.055, 52, 9)
    : item === "recon"
      ? new THREE.TorusKnotGeometry(0.2, 0.06, 48, 8)
      : new THREE.IcosahedronGeometry(0.28, 1);
  const object = new THREE.Mesh(geometry, material);
  object.position.y = 0.55;
  object.castShadow = true;
  const beam = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.22, 1.8, 12, 1, true),
    new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.14, side: THREE.DoubleSide }),
  );
  beam.position.y = 0.9;
  const light = new THREE.PointLight(color, 1.8, 3.2, 2);
  light.position.y = 0.8;
  group.add(object, beam, light);
  group.scale.setScalar(0.74);
  return group;
}

function makeLevelObject(kind: MatchView["map"]["objects"][number]["kind"], index: number) {
  const group = new THREE.Group();
  const metal = new THREE.MeshStandardMaterial({ color: index % 2 ? 0x344c52 : 0x604333, metalness: 0.48, roughness: 0.52 });
  const dark = new THREE.MeshStandardMaterial({ color: 0x101719, metalness: 0.62, roughness: 0.34 });
  const concrete = new THREE.MeshStandardMaterial({ color: 0x5a6260, roughness: 0.95 });
  const emissive = new THREE.MeshStandardMaterial({ color: 0x5bf1a4, emissive: 0x5bf1a4, emissiveIntensity: 3 });
  if (kind === "container") {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.88, 1.05, 0.88), metal);
    body.position.y = 0.52;
    group.add(body);
    for (let stripe = -2; stripe <= 2; stripe += 1) {
      const rib = new THREE.Mesh(new THREE.BoxGeometry(0.91, 0.035, 0.91), dark);
      rib.position.y = 0.18 + stripe * 0.16 + 0.35;
      group.add(rib);
    }
  } else if (kind === "crate") {
    const body = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.68, 0.72), metal);
    body.position.y = 0.34;
    const top = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.07, 0.78), dark);
    top.position.y = 0.7;
    const band = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.72, 0.09), dark);
    band.position.y = 0.35;
    group.add(body, top, band);
  } else if (kind === "barrier") {
    const block = new THREE.Mesh(new THREE.BoxGeometry(0.92, 0.48, 0.32), concrete);
    block.position.y = 0.24;
    block.rotation.y = index % 2 ? Math.PI / 2 : 0;
    const signal = new THREE.Mesh(new THREE.BoxGeometry(0.94, 0.08, 0.34), emissive);
    signal.position.y = 0.5;
    signal.rotation.y = block.rotation.y;
    group.add(block, signal);
  } else {
    const mast = new THREE.Mesh(new THREE.CylinderGeometry(0.07, 0.12, 1.5, 10), dark);
    mast.position.y = 0.75;
    const dish = new THREE.Mesh(new THREE.SphereGeometry(0.27, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2), metal);
    dish.position.set(0, 1.3, 0.08);
    dish.rotation.x = Math.PI / 2.8;
    const beacon = new THREE.Mesh(new THREE.SphereGeometry(0.065, 10, 8), emissive);
    beacon.position.y = 1.57;
    beacon.name = "beacon";
    group.add(mast, dish, beacon, new THREE.PointLight(0x5bf1a4, 1.4, 2.8));
    group.children.at(-1)!.position.y = 1.55;
  }
  group.rotation.y = (index % 4) * Math.PI / 2;
  group.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = true;
      object.receiveShadow = true;
    }
  });
  return group;
}

function concreteTexture() {
  const canvas = document.createElement("canvas");
  canvas.width = 256;
  canvas.height = 256;
  const context = canvas.getContext("2d")!;
  context.fillStyle = "#20282b";
  context.fillRect(0, 0, 256, 256);
  for (let index = 0; index < 3500; index += 1) {
    const shade = 25 + Math.floor(Math.random() * 30);
    context.fillStyle = `rgba(${shade},${shade + 6},${shade + 7},${Math.random() * 0.18})`;
    context.fillRect(Math.random() * 256, Math.random() * 256, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(8, 8);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function ArenaScene({ match }: { match: MatchView }) {
  const host = useRef<HTMLDivElement>(null);
  const latest = useRef(match);
  const [failure, setFailure] = useState(false);
  latest.current = match;

  useEffect(() => {
    if (!host.current) return;
    const mount = host.current;
    let renderer: THREE.WebGLRenderer;
    try {
      renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false, powerPreference: "high-performance" });
    } catch {
      setFailure(true);
      return;
    }
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    renderer.setSize(mount.clientWidth, mount.clientHeight);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.toneMapping = THREE.AgXToneMapping;
    renderer.toneMappingExposure = 1.05;
    mount.appendChild(renderer.domElement);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x071013);
    scene.fog = new THREE.FogExp2(0x071013, 0.024);
    const camera = new THREE.PerspectiveCamera(48, mount.clientWidth / Math.max(1, mount.clientHeight), 0.1, 100);
    const hemisphere = new THREE.HemisphereLight(0x91bfd2, 0x101315, 1.4);
    const moon = new THREE.DirectionalLight(0xd4f4ff, 4.2);
    moon.position.set(-7, 13, 8);
    moon.castShadow = true;
    moon.shadow.mapSize.set(1536, 1536);
    moon.shadow.camera.left = moon.shadow.camera.bottom = -12;
    moon.shadow.camera.right = moon.shadow.camera.top = 12;
    scene.add(hemisphere, moon);

    const size = match.map.size;
    const floorTexture = concreteTexture();
    const safeMaterial = new THREE.MeshStandardMaterial({ map: floorTexture, color: 0x637174, roughness: 0.94, metalness: 0.02 });
    const dangerMaterial = new THREE.MeshStandardMaterial({ map: floorTexture, color: 0x54292c, emissive: 0x290408, emissiveIntensity: 0.35, roughness: 0.95 });
    const tileGeometry = new THREE.BoxGeometry(0.96, 0.12, 0.96);
    const tiles: THREE.Mesh[] = [];
    for (let y = 0; y < size; y += 1) for (let x = 0; x < size; x += 1) {
      const tile = new THREE.Mesh(tileGeometry, safeMaterial);
      tile.position.copy(positionFor(x, y, size));
      tile.position.y = -0.08;
      tile.receiveShadow = true;
      tile.userData = { x, y };
      tiles.push(tile);
      scene.add(tile);
    }
    const base = new THREE.Mesh(new THREE.BoxGeometry(size + 1.5, 0.65, size + 1.5), new THREE.MeshStandardMaterial({ color: 0x101719, roughness: 0.78, metalness: 0.15 }));
    base.position.y = -0.48;
    base.receiveShadow = true;
    scene.add(base);

    const markingMaterial = new THREE.MeshBasicMaterial({ color: 0x92a69f, transparent: true, opacity: 0.2 });
    for (const offset of [-size * .24, size * .24]) {
      const lineX = new THREE.Mesh(new THREE.BoxGeometry(size - 1, .018, .045), markingMaterial);
      lineX.position.set(0, .005, offset);
      const lineZ = new THREE.Mesh(new THREE.BoxGeometry(.045, .018, size - 1), markingMaterial);
      lineZ.position.set(offset, .005, 0);
      scene.add(lineX, lineZ);
    }

    match.map.objects.forEach((object, index) => {
      const prop = makeLevelObject(object.kind, index);
      prop.position.copy(positionFor(object.x, object.y, size));
      scene.add(prop);
    });

    const buildingMaterial = new THREE.MeshStandardMaterial({ color: 0x182326, roughness: 0.83, metalness: 0.12 });
    for (let index = 0; index < 22; index += 1) {
      const angle = (index / 22) * Math.PI * 2;
      const radius = size * 0.72 + 2 + (index % 3);
      const width = 1.2 + (index % 4) * 0.43;
      const height = 2.3 + (index % 5) * 0.72;
      const building = new THREE.Mesh(new THREE.BoxGeometry(width, height, 1.5 + (index % 2)), buildingMaterial);
      building.position.set(Math.cos(angle) * radius, height / 2 - 0.4, Math.sin(angle) * radius);
      building.rotation.y = -angle;
      building.castShadow = building.receiveShadow = true;
      scene.add(building);
    }

    const zoneMaterial = new THREE.MeshBasicMaterial({ color: 0xff3347, transparent: true, opacity: 0.08, side: THREE.DoubleSide, depthWrite: false });
    const nextMaterial = new THREE.MeshBasicMaterial({ color: 0x5bf1a4, transparent: true, opacity: 0.64 });
    const zoneWalls = Array.from({ length: 4 }, () => new THREE.Mesh(new THREE.PlaneGeometry(1, 3.5), zoneMaterial));
    const nextLines = Array.from({ length: 4 }, () => new THREE.Mesh(new THREE.BoxGeometry(1, 0.045, 0.045), nextMaterial));
    zoneWalls.forEach((wall) => scene.add(wall));
    nextLines.forEach((line) => scene.add(line));

    const sightMaterial = new THREE.MeshBasicMaterial({ color: 0x50d8ff, transparent: true, opacity: .72, depthWrite: false });
    const sightLines = Array.from({ length: 4 }, () => new THREE.Mesh(new THREE.BoxGeometry(1, .035, .035), sightMaterial));
    const sightArea = new THREE.Mesh(
      new THREE.PlaneGeometry(1, 1),
      new THREE.MeshBasicMaterial({ color: 0x44cfff, transparent: true, opacity: .028, side: THREE.DoubleSide, depthWrite: false }),
    );
    sightArea.rotation.x = -Math.PI / 2;
    sightArea.position.y = .025;
    sightLines.forEach((line) => { line.position.y = .065; scene.add(line); });
    scene.add(sightArea);

    const playerObjects = new Map<number, THREE.Group>();
    const lootObjects = new Map<string, THREE.Group>();
    const desired = new Map<number, THREE.Vector3>();
    const cameraTarget = new THREE.Vector3();
    const cameraDesired = new THREE.Vector3();
    let animation = 0;

    const placeBounds = (objects: THREE.Mesh[], inset: number, wall: boolean) => {
      const span = Math.max(1, size - inset * 2);
      const edge = (span - 1) / 2 + 0.5;
      const center = 0;
      objects[0].position.set(center, wall ? 1.55 : 0.05, -edge);
      objects[1].position.set(center, wall ? 1.55 : 0.05, edge);
      objects[2].position.set(-edge, wall ? 1.55 : 0.05, center);
      objects[3].position.set(edge, wall ? 1.55 : 0.05, center);
      objects[0].scale.set(span, 1, 1);
      objects[1].scale.set(span, 1, 1);
      objects[2].scale.set(span, 1, 1);
      objects[3].scale.set(span, 1, 1);
      if (wall) {
        objects[0].rotation.y = objects[1].rotation.y = 0;
        objects[2].rotation.y = objects[3].rotation.y = Math.PI / 2;
      } else {
        objects[2].rotation.y = objects[3].rotation.y = Math.PI / 2;
      }
    };

    const animate = (elapsed: number) => {
      const state = latest.current;
      const inset = state.map.inset;
      tiles.forEach((tile) => {
        const { x, y } = tile.userData as { x: number; y: number };
        tile.material = x < inset || y < inset || x >= size - inset || y >= size - inset ? dangerMaterial : safeMaterial;
      });
      placeBounds(zoneWalls, inset, true);
      zoneMaterial.opacity = 0.065 + Math.sin(elapsed * 0.004) * 0.02;
      if (state.map.nextInset === null) nextLines.forEach((line) => { line.visible = false; });
      else {
        nextLines.forEach((line) => { line.visible = true; });
        placeBounds(nextLines, state.map.nextInset, false);
      }

      const visiblePlayers = new Set(state.map.players.map((player) => player.id));
      for (const player of state.map.players) {
        let group = playerObjects.get(player.id);
        if (!group) {
          group = makeOperative(player.id === state.self.id, player.name);
          playerObjects.set(player.id, group);
          group.position.copy(positionFor(player.x, player.y, size));
          scene.add(group);
        }
        desired.set(player.id, positionFor(player.x, player.y, size));
        group.visible = true;
        group.userData.connected = player.connected;
        const ring = group.getObjectByName("status-ring") as THREE.Mesh | undefined;
        if (ring) {
          ring.scale.setScalar(player.status === "duel" ? 1.45 + Math.sin(elapsed * 0.008) * 0.12 : player.protected ? 1.22 : 1);
          ring.rotation.z = elapsed * 0.001;
        }
      }
      for (const [id, group] of playerObjects) {
        if (!visiblePlayers.has(id)) group.visible = false;
        const target = desired.get(id);
        const player = state.map.players.find((candidate) => candidate.id === id);
        if (target && player && group.visible) {
          const dx = target.x - group.position.x;
          const dz = target.z - group.position.z;
          const moving = Math.hypot(dx, dz) > .025;
          const desiredAngle = FACING_ANGLE[player.facing];
          let delta = desiredAngle - group.rotation.y;
          delta = Math.atan2(Math.sin(delta), Math.cos(delta));
          group.rotation.y += delta * .2;
          group.position.x += dx * .115;
          group.position.z += dz * .115;
          group.position.y = moving ? Math.abs(Math.sin(elapsed * .017 + id)) * .055 : 0;
          const leftLeg = group.getObjectByName("left-leg");
          const rightLeg = group.getObjectByName("right-leg");
          if (leftLeg && rightLeg) {
            const stride = moving ? Math.sin(elapsed * .018) * .55 : 0;
            leftLeg.rotation.x = stride;
            rightLeg.rotation.x = -stride;
          }
          group.traverse((object) => { object.visible = group!.visible; });
        }
      }

      const visibleLoot = new Set(state.map.loot.map((loot) => loot.id));
      for (const loot of state.map.loot) {
        let group = lootObjects.get(loot.id);
        if (!group) {
          group = makeLoot(loot.item);
          group.position.copy(positionFor(loot.x, loot.y, size));
          lootObjects.set(loot.id, group);
          scene.add(group);
        }
        group.visible = true;
        group.rotation.y = elapsed * 0.0014;
        group.position.y = Math.sin(elapsed * 0.003 + loot.x) * 0.08;
      }
      for (const [id, group] of lootObjects) if (!visibleLoot.has(id)) group.visible = false;

      const self = state.map.players.find((player) => player.id === state.self.id);
      if (self && state.self.status !== "eliminated") {
        const selfPosition = positionFor(self.x, self.y, size);
        const visionSpan = state.map.vision * 2 + 1;
        const visionEdge = visionSpan / 2;
        sightArea.visible = true;
        sightArea.position.set(selfPosition.x, .02, selfPosition.z);
        sightArea.scale.set(visionSpan, visionSpan, 1);
        sightLines.forEach((line) => { line.visible = true; });
        sightLines[0].position.set(selfPosition.x, .07, selfPosition.z - visionEdge);
        sightLines[1].position.set(selfPosition.x, .07, selfPosition.z + visionEdge);
        sightLines[2].position.set(selfPosition.x - visionEdge, .07, selfPosition.z);
        sightLines[3].position.set(selfPosition.x + visionEdge, .07, selfPosition.z);
        sightLines[0].scale.set(visionSpan, 1, 1);
        sightLines[1].scale.set(visionSpan, 1, 1);
        sightLines[2].scale.set(visionSpan, 1, 1);
        sightLines[3].scale.set(visionSpan, 1, 1);
        sightLines[2].rotation.y = sightLines[3].rotation.y = Math.PI / 2;
        sightMaterial.opacity = .5 + Math.sin(elapsed * .004) * .22;
        cameraDesired.set(selfPosition.x + 2.2, 10.4, selfPosition.z + 10.2);
        cameraTarget.set(selfPosition.x, 0.55, selfPosition.z - 2.4);
      } else {
        sightArea.visible = false;
        sightLines.forEach((line) => { line.visible = false; });
        cameraDesired.set(0, 11.5, 10.5);
        cameraTarget.set(0, 0, 0);
      }
      camera.position.lerp(cameraDesired, 0.055);
      camera.lookAt(cameraTarget);
      renderer.render(scene, camera);
      animation = requestAnimationFrame(animate);
    };
    animation = requestAnimationFrame(animate);
    const resize = new ResizeObserver(() => {
      const width = mount.clientWidth;
      const height = Math.max(1, mount.clientHeight);
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height);
    });
    resize.observe(mount);

    return () => {
      cancelAnimationFrame(animation);
      resize.disconnect();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) object.geometry.dispose();
        if (object instanceof THREE.Mesh || object instanceof THREE.Sprite) {
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => {
            const map = (material as THREE.MeshStandardMaterial).map;
            if (map && map !== floorTexture) map.dispose();
            material.dispose();
          });
        }
      });
      floorTexture.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [match.map.size]);

  return <div ref={host} className="arena-3d">{failure && <div className="webgl-error">WebGL недоступен. Включите аппаратное ускорение браузера.</div>}</div>;
}

function TacticalRadar({ match }: { match: MatchView }) {
  const scale = (value: number) => `${((value + 0.5) / match.map.size) * 100}%`;
  const zoneSize = `${((match.map.size - match.map.inset * 2) / match.map.size) * 100}%`;
  const zoneOffset = `${(match.map.inset / match.map.size) * 100}%`;
  const nextSize = match.map.nextInset === null ? null : `${((match.map.size - match.map.nextInset * 2) / match.map.size) * 100}%`;
  const nextOffset = match.map.nextInset === null ? null : `${(match.map.nextInset / match.map.size) * 100}%`;
  return (
    <div className="hud-radar" aria-label="Тактический радар">
      <div className="radar-north">С</div>
      <div className="radar-grid" />
      <div
        className="radar-vision"
        style={{
          width: `${((match.map.vision * 2 + 1) / match.map.size) * 100}%`,
          height: `${((match.map.vision * 2 + 1) / match.map.size) * 100}%`,
          left: scale(match.self.x),
          top: scale(match.self.y),
        }}
      />
      <div className="radar-zone" style={{ width: zoneSize, height: zoneSize, left: zoneOffset, top: zoneOffset }} />
      {nextSize && <div className="radar-next" style={{ width: nextSize, height: nextSize, left: nextOffset!, top: nextOffset! }} />}
      {match.map.objects.map((object, index) => <span key={`${object.x}-${object.y}-${index}`} className={`radar-object ${object.kind}`} style={{ left: scale(object.x), top: scale(object.y) }} />)}
      {match.map.loot.map((loot) => <span key={loot.id} className={`radar-dot loot ${loot.item}`} style={{ left: scale(loot.x), top: scale(loot.y) }} title={itemInfo[loot.item].name} />)}
      {match.map.players.map((player) => <span key={player.id} className={`radar-dot ${player.id === match.self.id ? "self" : "enemy"} ${player.status}`} style={{ left: scale(player.x), top: scale(player.y) }} title={player.name} />)}
      <div className="radar-sweep" />
      <div className="radar-caption"><span>ТАКТИЧЕСКАЯ СЕТЬ</span><b>{match.map.vision * 100} м</b></div>
    </div>
  );
}

export function ArenaMap({ match, now, send }: { match: MatchView; now: number; send: Send }) {
  const lastMove = useRef(0);
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.repeat || match.self.status !== "free") return;
      const target = event.target as HTMLElement | null;
      if (target?.closest("input, textarea, select, button, [contenteditable=true]")) return;
      const direction = DIRECTIONS[event.code];
      if (!direction || Date.now() - lastMove.current < match.map.moveMs * 0.7) return;
      event.preventDefault();
      lastMove.current = Date.now();
      send({ type: "move", direction });
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [match.map.moveMs, match.self.status, send]);

  const zoneDeadline = match.map.nextAt;
  const outside = match.self.outsideDeadline !== null;
  const self = match.map.players.find((player) => player.id === match.self.id);
  return (
    <div className={`world-layer ${outside ? "outside-zone" : ""}`}>
      <ArenaScene match={match} />
      <div className="world-vignette" />
      <div className="hud-top-left">
        <span className="hud-eyebrow">ОПЕРАЦИЯ FEBUS · СЕКТОР {match.map.inset + 1}</span>
        <strong>{match.map.final ? "ФИНАЛЬНОЕ СТОЛКНОВЕНИЕ" : "СЖАТИЕ ПЕРИМЕТРА"}</strong>
        <small>КООРДИНАТЫ {String(self?.x ?? match.self.x).padStart(2, "0")} : {String(self?.y ?? match.self.y).padStart(2, "0")}</small>
      </div>
      <div className={`hud-zone ${outside ? "danger" : ""}`}>
        <span>{outside ? "ПОКИНЬТЕ ОПАСНУЮ ЗОНУ" : match.map.final ? "ПЕРЕМЕЩЕНИЕ ЗАБЛОКИРОВАНО" : "ДО СУЖЕНИЯ ЗОНЫ"}</span>
        <strong>{outside && match.self.outsideDeadline ? timeLeft(match.self.outsideDeadline, now) : zoneDeadline ? timeLeft(zoneDeadline, now) : "--:--"}</strong>
        <div><i style={{ width: outside ? "100%" : "62%" }} /></div>
      </div>
      <TacticalRadar match={match} />
      <div className="hud-crosshair"><i /><i /><b /></div>
      <div className="hud-controls"><kbd>W</kbd><kbd>A</kbd><kbd>S</kbd><kbd>D</kbd><span>ПЕРЕМЕЩЕНИЕ ПО СЕКТОРАМ</span></div>
      {match.self.reconUntil > now && <div className="hud-recon"><i /> РАЗВЕДКА АКТИВНА <b>{timeLeft(match.self.reconUntil, now)}</b></div>}
      <div className="hud-connection"><i className={self?.connected ? "online" : "offline"} /> СЕРВЕР · {self?.connected ? "СИНХРОНИЗИРОВАН" : "НЕТ СВЯЗИ"}</div>
    </div>
  );
}
