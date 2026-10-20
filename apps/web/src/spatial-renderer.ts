import {
  ACESFilmicToneMapping, BackSide, BoxGeometry, Color, CylinderGeometry, DirectionalLight,
  DoubleSide, Group, HemisphereLight, LatheGeometry, Mesh, MeshBasicMaterial,
  MeshPhysicalMaterial, MeshStandardMaterial, PCFShadowMap, PerspectiveCamera,
  PlaneGeometry, PMREMGenerator, PointLight, Scene, ShadowMaterial, SphereGeometry, SRGBColorSpace,
  TorusGeometry, Vector2, WebGLRenderer, type BufferGeometry, type Material,
} from 'three';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

export type CareFocus = 'home' | 'meal' | 'visit' | 'ride';
export type SpatialFrame = { yaw: number; pitch: number; phase: number; spread: number; daylight: boolean; focus?: CareFocus };
export type SpatialRenderer = { resize: (width: number, height: number) => void; render: (frame: SpatialFrame) => void; dispose: () => void };

/** Optional architectural illustration. It receives no household or task facts. */
export function createSpatialRenderer(canvas: HTMLCanvasElement): SpatialRenderer {
  const renderer = new WebGLRenderer({ canvas, alpha: true, antialias: true, powerPreference: 'low-power', preserveDrawingBuffer: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
  renderer.setClearColor(0x000000, 0);
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.toneMapping = ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.03;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  const scene = new Scene();
  const camera = new PerspectiveCamera(35, 1, .1, 30);
  let cameraDistance = 4.75;
  const resources: { dispose: () => void }[] = [];
  const track = <T extends { dispose: () => void }>(resource: T): T => { resources.push(resource); return resource; };
  let disposed = false;
  const dispose = () => {
    if (disposed) return;
    disposed = true;
    resources.forEach(resource => resource.dispose());
    renderer.dispose(); renderer.forceContextLoss();
  };

  try {
    // Locally generated studio reflections give ceramic, glass and brushed metal
    // a shared physical setting without loading images, models or remote assets.
    const studio = new Scene();
    studio.background = new Color(0x343c3b);
    studio.add(new Mesh(track(new BoxGeometry(12, 12, 12)), track(new MeshBasicMaterial({ color: 0x283435, side: BackSide }))));
    const panel = (x: number, y: number, z: number, w: number, h: number, color: number, intensity: number) => {
      const light = new Mesh(track(new PlaneGeometry(w, h)), track(new MeshBasicMaterial({ color: new Color(color).multiplyScalar(intensity), side: DoubleSide })));
      light.position.set(x, y, z); light.lookAt(0, 0, 0); studio.add(light);
    };
    panel(-3.5, 3, 3, 3, 5.5, 0xfff6e3, 4.1);
    panel(3, 2, 2, 1.7, 4, 0xc8f2df, 3);
    panel(-1, 4, -1, 4, 2, 0xffffff, 3.6);
    panel(2, 1, -4, 3, 3, 0xa6c3cc, 1.8);
    const generator = new PMREMGenerator(renderer);
    try { scene.environment = track(generator.fromScene(studio, .045, .1, 20, { size: 128 })).texture; }
    finally { generator.dispose(); }
    scene.environmentIntensity = .72;

    const ceramic = track(new MeshPhysicalMaterial({ color: 0xb4bca9, roughness: .58, metalness: .02, clearcoat: .18, clearcoatRoughness: .36 }));
    const pearl = track(new MeshPhysicalMaterial({ color: 0xd6decd, roughness: .32, metalness: .04, clearcoat: .38 }));
    const roofMaterial = track(new MeshPhysicalMaterial({ color: 0x536d5c, roughness: .42, metalness: .22, clearcoat: .32, clearcoatRoughness: .3 }));
    const sage = track(new MeshStandardMaterial({ color: 0x647b6d, roughness: .76, metalness: .03 }));
    const linen = track(new MeshStandardMaterial({ color: 0xa9967b, roughness: .85 }));
    const wood = track(new MeshStandardMaterial({ color: 0x856747, roughness: .63, metalness: .02 }));
    const metal = track(new MeshPhysicalMaterial({ color: 0x617b6f, metalness: .88, roughness: .39, anisotropy: .45 }));
    const bronze = track(new MeshPhysicalMaterial({ color: 0x71664a, metalness: .79, roughness: .37, clearcoat: .28 }));
    const charcoal = track(new MeshStandardMaterial({ color: 0x1b2929, metalness: .3, roughness: .51 }));
    const glass = track(new MeshPhysicalMaterial({ color: 0xd4eddf, roughness: .08, metalness: .02, transmission: .88, thickness: .07, ior: 1.45, clearcoat: .8, attenuationColor: 0xc0dfce, attenuationDistance: 2 }));
    const carGlass = track(new MeshPhysicalMaterial({ color: 0x314c4f, roughness: .1, metalness: .28, transmission: .22, thickness: .1, clearcoat: 1 }));
    const glow = track(new MeshStandardMaterial({ color: 0xffdf9d, emissive: 0xffce81, emissiveIntensity: .6, roughness: .38 }));
    const lightGuide = track(new MeshStandardMaterial({ color: 0x9ec8aa, emissive: 0x72b296, emissiveIntensity: .4, roughness: .42, metalness: .15 }));
    const rubber = track(new MeshStandardMaterial({ color: 0x172222, roughness: .82 }));
    const soup = track(new MeshStandardMaterial({ color: 0xc28a48, roughness: .4, metalness: .03 }));
    const leaves = track(new MeshStandardMaterial({ color: 0x587c4c, roughness: .74 }));
    const tailLight = track(new MeshStandardMaterial({ color: 0x9d5e48, emissive: 0x6d3328, emissiveIntensity: .25, roughness: .3 }));
    const world = new Group();
    scene.add(world);

    const mesh = (geometry: BufferGeometry, material: Material, parent: Group | Scene, x = 0, y = 0, z = 0) => {
      const part = new Mesh(track(geometry), material);
      part.position.set(x, y, z); part.castShadow = true; part.receiveShadow = true; parent.add(part); return part;
    };
    const block = (parent: Group | Scene, material: Material, w: number, h: number, d: number, x: number, y: number, z: number, radius = .025) => mesh(new RoundedBoxGeometry(w, h, d, 2, Math.min(radius, w / 3, h / 3, d / 3)), material, parent, x, y, z);
    const cylinder = (parent: Group | Scene, material: Material, radius: number, height: number, x: number, y: number, z: number, bottom = radius) => mesh(new CylinderGeometry(radius, bottom, height, 28), material, parent, x, y, z);

    // A recognizably domestic cutaway: pitched roof, open glazed frontage,
    // upholstered sofa, coffee table, cup, standing lamp and a little plant.
    const home = new Group(); home.position.z = -.22; world.add(home);
    block(home, charcoal, 1.92, .15, 1.46, 0, -.52, 0, .08);
    block(home, ceramic, 1.87, .08, 1.41, 0, -.43, 0, .07);
    block(home, lightGuide, 1.73, .012, .014, 0, -.486, .732, .004);
    [-.95, .95].forEach(x => block(home, lightGuide, .009, .01, 1.22, x, -.486, 0, .003));
    block(home, wood, 1.47, .035, 1.03, 0, -.372, 0, .012);
    block(home, ceramic, 1.50, .81, .07, 0, .045, -.495);
    block(home, ceramic, .07, .81, 1.02, -.72, .045, 0);
    block(home, ceramic, .07, .18, 1.02, .72, -.27, 0);
    const rightGlass = block(home, glass, .025, .64, 1.02, .72, .11, 0, .006); rightGlass.castShadow = false;
    [-.72, .72].forEach(x => block(home, bronze, .025, .83, .03, x, .055, .52, .004));
    block(home, bronze, 1.49, .025, .04, 0, .46, .52, .004);
    const windowLeft = block(home, glass, .41, .69, .022, -.49, .018, .524, .004); windowLeft.castShadow = false;
    const windowRight = block(home, glass, .39, .69, .022, .50, .018, .524, .004); windowRight.castShadow = false;
    [-.265, .29].forEach(x => block(home, bronze, .019, .7, .025, x, .017, .525, .003));
    // A low threshold, not a closed door, keeps the interior readable at phone size.
    block(home, pearl, .53, .035, .16, .01, -.38, .62, .012);
    const roof = new Group(); home.add(roof);
    const leftRoof = block(roof, roofMaterial, .9, .065, 1.25, -.405, .63, 0, .018); leftRoof.rotation.z = .39;
    const rightRoof = block(roof, roofMaterial, .9, .065, 1.25, .405, .63, 0, .018); rightRoof.rotation.z = -.39;
    const ridge = block(roof, bronze, .045, .045, 1.28, 0, .805, 0, .012);
    ridge.castShadow = false;
    const eaveLeft = block(roof, bronze, .88, .015, .025, -.405, .593, .62, .004); eaveLeft.rotation.z = .39;
    const eaveRight = block(roof, bronze, .88, .015, .025, .405, .593, .62, .004); eaveRight.rotation.z = -.39;
    // Architectural rooflight rather than decorative tech or invented activity.
    const rooflight = block(roof, glass, .42, .02, .49, .43, .68, -.07, .009); rooflight.rotation.z = -.39;

    const sofa = new Group(); sofa.position.set(-.20, -.31, -.24); home.add(sofa);
    block(sofa, wood, .75, .055, .33, 0, 0, 0, .012);
    block(sofa, sage, .75, .21, .075, 0, .135, -.14, .034);
    [-.18, .18].forEach(x => block(sofa, sage, .34, .09, .25, x, .075, .005, .026));
    [-.365, .365].forEach(x => block(sofa, sage, .07, .18, .33, x, .09, 0, .027));
    cylinder(home, wood, .19, .038, -.08, -.17, .15);
    cylinder(home, bronze, .022, .175, -.08, -.277, .15);
    cylinder(home, charcoal, .075, .014, -.08, -.355, .15);
    cylinder(home, pearl, .026, .036, -.045, -.13, .15);
    const cupHandle = mesh(new TorusGeometry(.014, .004, 6, 14), pearl, home, -.016, -.129, .15); cupHandle.rotation.y = Math.PI / 2;
    cylinder(home, bronze, .008, .48, .50, -.115, -.27);
    cylinder(home, bronze, .065, .013, .50, -.352, -.27);
    const shade = mesh(new CylinderGeometry(.065, .102, .13, 28, 1, true), pearl, home, .50, .135, -.27); shade.material.side = DoubleSide;
    mesh(new SphereGeometry(.027, 12, 8), glow, home, .50, .084, -.27);
    const interiorLight = new PointLight(0xffd49a, .32, 1.8, 2);
    interiorLight.position.set(.26, .20, .03); home.add(interiorLight);
    const art = block(home, wood, .22, .26, .022, .27, .18, -.45, .006);
    block(home, linen, .19, .23, .025, art.position.x, art.position.y, -.433, .004);
    block(home, sage, .072, .135, .009, .24, .18, -.416, .008);
    cylinder(home, ceramic, .053, .09, -.58, -.315, .29, .044);
    for (let index = 0; index < 5; index++) {
      const leaf = mesh(new SphereGeometry(.032, 10, 8), leaves, home, -.58 + Math.sin(index * 2.4) * .042, -.22 + index % 2 * .026, .29 + Math.cos(index * 2.4) * .035);
      leaf.scale.set(.65, 1.7, .55); leaf.rotation.z = Math.sin(index) * .5;
    }

    // Independent little service stations make the product categories legible.
    // Their accents illustrate a selected category, never a factual acceptance.
    const stations: Record<'meal' | 'visit' | 'ride', Group> = { meal: new Group(), visit: new Group(), ride: new Group() };
    stations.meal.position.set(-1.27, 0, .75);
    stations.visit.position.set(1.51, 0, -.49);
    stations.ride.position.set(.83, 0, 1.08);
    const accents: Record<CareFocus, MeshStandardMaterial> = {
      home: track(new MeshStandardMaterial({ color: 0xc7bf9d, emissive: 0xb69c59, emissiveIntensity: .15, roughness: .4, metalness: .45 })),
      meal: track(new MeshStandardMaterial({ color: 0xc7bf9d, emissive: 0xb69c59, emissiveIntensity: .15, roughness: .4, metalness: .45 })),
      visit: track(new MeshStandardMaterial({ color: 0x9bbbae, emissive: 0x76a695, emissiveIntensity: .15, roughness: .4, metalness: .45 })),
      ride: track(new MeshStandardMaterial({ color: 0x9daeb8, emissive: 0x7398a8, emissiveIntensity: .15, roughness: .4, metalness: .45 })),
    };
    block(home, accents.home, 1.66, .012, .014, 0, -.407, .701, .004);
    for (const [kind, station] of Object.entries(stations) as ['meal' | 'visit' | 'ride', Group][]) {
      world.add(station);
      cylinder(station, charcoal, .445, .12, 0, -.535, 0, .46);
      cylinder(station, ceramic, .44, .037, 0, -.458, 0);
      const edge = mesh(new TorusGeometry(.437, .009, 6, 56), accents[kind], station, 0, -.445, 0); edge.rotation.x = Math.PI / 2;
    }
    const meal = stations.meal;
    cylinder(meal, pearl, .252, .023, -.012, -.42, 0);
    const plateRim = mesh(new TorusGeometry(.231, .014, 8, 40), pearl, meal, -.012, -.402, 0); plateRim.rotation.x = Math.PI / 2;
    const bowlProfile = [new Vector2(0, -.08), new Vector2(.065, -.08), new Vector2(.13, -.032), new Vector2(.166, .041), new Vector2(.153, .045), new Vector2(.12, -.025), new Vector2(.06, -.062), new Vector2(0, -.062)];
    mesh(new LatheGeometry(bowlProfile, 36), pearl, meal, -.012, -.315, 0);
    cylinder(meal, soup, .145, .008, -.012, -.279, 0);
    for (let index = 0; index < 3; index++) {
      const leaf = mesh(new SphereGeometry(.023, 10, 6), leaves, meal, -.027 + Math.sin(index * 2) * .035, -.27, Math.cos(index * 2) * .041);
      leaf.scale.set(.7, .22, 1.7); leaf.rotation.y = index * 1.1;
    }
    block(meal, metal, .025, .009, .3, .308, -.41, 0, .004);
    block(meal, metal, .024, .009, .29, -.327, -.41, -.005, .004);
    [-.014, 0, .014].forEach(x => block(meal, metal, .007, .009, .052, -.327 + x, -.41, -.169, .002));
    block(meal, linen, .135, .01, .235, -.28, -.431, 0, .009);

    const visit = stations.visit;
    const chair = (x: number, angle: number, material: Material) => {
      const group = new Group(); group.position.set(x, -.36, .035); group.rotation.y = angle; visit.add(group);
      block(group, wood, .24, .04, .24, 0, 0, 0, .007);
      block(group, material, .235, .065, .235, 0, .045, 0, .022);
      block(group, material, .245, .24, .055, 0, .145, -.095, .026);
      [-.115, .115].forEach(side => block(group, wood, .027, .12, .23, side, .035, 0, .01));
      return group;
    };
    chair(-.21, Math.PI / 2, sage); chair(.21, -Math.PI / 2, linen);
    cylinder(visit, wood, .081, .025, 0, -.255, .075);
    cylinder(visit, bronze, .01, .15, 0, -.341, .075);
    // An open doorway lends the visit station a familiar, welcoming silhouette.
    [-.25, .25].forEach(x => block(visit, metal, .026, .53, .034, x, -.175, -.265, .009));
    block(visit, metal, .526, .028, .034, 0, .09, -.265, .009);

    const ride = stations.ride;
    const car = new Group(); car.rotation.y = -.16; ride.add(car);
    block(car, pearl, .68, .14, .32, 0, -.315, 0, .055);
    block(car, carGlass, .345, .165, .272, -.035, -.193, 0, .055);
    block(car, ceramic, .288, .024, .245, -.055, -.10, 0, .015);
    [-.217, .217].forEach(x => [-.171, .171].forEach(z => {
      const tyre = cylinder(car, rubber, .078, .047, x, -.364, z); tyre.rotation.x = Math.PI / 2;
      const hub = cylinder(car, metal, .045, .05, x, -.364, z); hub.rotation.x = Math.PI / 2;
    }));
    [-.108, .108].forEach(z => {
      block(car, glow, .02, .034, .07, .34, -.30, z, .008);
      block(car, tailLight, .015, .031, .065, -.34, -.298, z, .007);
    });
    block(car, charcoal, .012, .036, .15, .35, -.338, 0, .004);
    block(car, metal, .03, .009, .08, .08, -.235, .166, .003);

    // Small etched paths imply a care circle in the illustration only. They do
    // not attach helpers to tasks, imply dispatch or display an address.
    const paths = [
      { x: -.96, z: .46, angle: .62, length: .34 },
      { x: 1.02, z: -.42, angle: 0, length: .20 },
      { x: .71, z: .61, angle: -Math.PI / 2, length: .28 },
    ];
    paths.forEach(path => {
      const step = block(world, bronze, path.length, .045, .10, path.x, -.515, path.z, .012); step.rotation.y = path.angle;
      const guide = block(world, lightGuide, path.length * .9, .008, .013, path.x, -.488, path.z, .003); guide.rotation.y = path.angle;
    });
    const floor = mesh(new PlaneGeometry(12, 12), track(new ShadowMaterial({ color: 0x081313, opacity: .2 })), scene, 0, -.63, 0);
    floor.rotation.x = -Math.PI / 2; floor.castShadow = false;
    const ambient = new HemisphereLight(0xfff5df, 0x2d4040, 1.3); scene.add(ambient);
    const key = new DirectionalLight(0xfff0d5, 2.9); key.position.set(-3, 5, 4); key.castShadow = true;
    key.shadow.mapSize.set(512, 512); key.shadow.camera.left = -3; key.shadow.camera.right = 3;
    key.shadow.camera.top = 3; key.shadow.camera.bottom = -3; key.shadow.camera.far = 14;
    key.shadow.bias = -.0007; key.shadow.normalBias = .016; key.shadow.radius = 4; key.shadow.intensity = .6;
    scene.add(key); resources.push({ dispose: () => key.shadow.dispose() });
    const rim = new DirectionalLight(0xa3ddc8, 1.7); rim.position.set(3, 2, -2); scene.add(rim);
    const fill = new DirectionalLight(0xcadce8, .8); fill.position.set(-2, 1, -3); scene.add(fill);

    return {
      resize(width, height) {
        if (disposed) return;
        renderer.setSize(Math.max(1, width), Math.max(1, height), false);
        camera.aspect = Math.max(1, width) / Math.max(1, height);
        cameraDistance = Math.max(4.75, 4.3 / camera.aspect);
        camera.position.set(.12, 2.68, cameraDistance);
        camera.lookAt(0, -.1, .1); camera.updateProjectionMatrix();
      },
      render(frame) {
        if (disposed || renderer.getContext().isContextLost()) return;
        const focus = frame.focus || 'home';
        // Bounded breathing drift preserves the building's orientation. Dragging
        // still explores another view, but the home never spins continuously.
        world.rotation.set(frame.pitch * .35, frame.yaw * .65 + Math.sin(frame.phase * .2) * .11, 0);
        roof.position.y = frame.spread * .62;
        roof.rotation.x = frame.spread * -.075;
        rightGlass.position.x = .72 + frame.spread * .12;
        for (const kind of ['home', 'meal', 'visit', 'ride'] as const) {
          accents[kind].emissiveIntensity = kind === focus ? .5 : .08;
          if (kind !== 'home') {
            stations[kind].position.y = kind === focus ? .045 : 0;
            stations[kind].scale.setScalar(kind === focus ? 1.045 : 1);
          }
        }
        const target = focus === 'home' ? home.position : stations[focus].position;
        camera.position.set(.12 + target.x * .035, 2.68 + frame.spread * .16, cameraDistance + frame.spread * .40);
        camera.lookAt(target.x * .065, -.08 + frame.spread * .1, .1 + target.z * .04);
        renderer.toneMappingExposure = frame.daylight ? 1 : 1.03;
        ambient.intensity = frame.daylight ? 1.65 : 1.3;
        renderer.render(scene, camera);
      },
      dispose,
    };
  } catch (error) {
    dispose();
    throw error;
  }
}
