// ============================================================
// PLAYER (Self-hosted audio via native <audio> + R2)
// Replaces the SoundCloud iframe with a native <audio> element.
// No SC Widget API, no SC API script, no third-party subprocess.
// All UI (iPod shell, artwork slideshow, visualizer, seek bar,
// track list) is preserved exactly.
// Data attribute exposed for styling hooks:
//   [data-sc-state="idle|playing|paused"]  on #soundcloud-player
//
// SETUP:
//   1. Set R2_BASE_URL to your R2 bucket public URL (no trailing slash).
//   2. Upload each track as  audio/{title}.mp3  to that bucket.
//   3. Optionally paste a SoundCloud wave CDN URL into waveformUrl
//      for each track to keep the visualizer bars animated.
//      Leave "" to skip (bars stay flat/idle for that track).
// ============================================================

document.addEventListener("DOMContentLoaded", () => {
  // ── CONFIG ────────────────────────────────────────────────
  const R2_BASE_URL = "https://data.kami.h80h.xyz";

  // [title, audioKey, waveformUrl, roomIds]
  const PLAYLIST = [
    [
      "Arrival",
      "arrival",
      "https://wave.sndcdn.com/mrH4tCJrfPPF_m.json",
      ["00", "01", "02-1", "03-1"],
    ],
    [
      "Mina's Shop",
      "mina",
      "https://wave.sndcdn.com/e7edW7YUlJyH_m.json",
      ["13"],
    ],
    [
      "Cave",
      "cave",
      "https://wave.sndcdn.com/pJ4kJObWaipa_m.json",
      ["29", "30", "31", "32", "47"],
    ],
    ["Market", "market", "https://wave.sndcdn.com/LDlWxESnszrM_m.json", ["66"]],
    [
      "Amusement",
      "amusement",
      "https://wave.sndcdn.com/y9lLjXdF9BfS_m.json",
      ["05-1", "06-1"],
    ],
    [
      "Butterfly Forest",
      "k8",
      "https://wave.sndcdn.com/zER3oa48qIv3_m.json",
      ["55", "56", "57", "63"],
    ],
    ["Centipedes", "k5", "https://wave.sndcdn.com/oGutD7fMaq4W_m.json", ["62"]],
    [
      "Deeper into the Scrap",
      "k1",
      "https://wave.sndcdn.com/N2VxIjA5Z5RF_m.json",
      ["12", "34", "58", "60"],
    ],
    [
      "Arrival Night",
      "arrivalNight",
      "https://wave.sndcdn.com/2CGmfWGvqbSQ_m.json",
      ["02-2", "03-2"],
    ],
    [
      "Forest Hut",
      "k3",
      "https://wave.sndcdn.com/vZHU5VfQfbWi_m.json",
      ["64", "65"],
    ],
    [
      "Forest",
      "k11",
      "https://wave.sndcdn.com/taBquIzmH6Cl_m.json",
      ["09", "33", "36", "48"],
    ],
    [
      "Glitter",
      "glitter",
      "https://wave.sndcdn.com/IC4wFSLYP9kZ_m.json",
      ["11"],
    ],
    [
      "Lost Skeleton",
      "k13",
      "https://wave.sndcdn.com/lG4cyZo33xGQ_m.json",
      ["25", "37", "49"],
    ],
    [
      "Amusement Night",
      "amusementNight",
      "https://wave.sndcdn.com/BK530KsHCZMV_m.json",
      ["05-2", "06-2"],
    ],
    [
      "Musty Forest Path",
      "k4",
      "https://wave.sndcdn.com/Eyk8LPvE3R1c_m.json",
      ["10", "35", "50", "51", "61"],
    ],
    [
      "Mystique",
      "mystique",
      "https://wave.sndcdn.com/zstkFaKysCvN_m.json",
      ["04"],
    ],
    [
      "Trash-Strewn Graves",
      "k9",
      "https://wave.sndcdn.com/s3uCx1ZgqVwS_m.json",
      ["26", "53"],
    ],
    [
      "Airplane",
      "k2",
      "https://wave.sndcdn.com/T075kOqe1TY4_m.json",
      ["52", "54"],
    ],
    [
      "Temple Cave",
      "templeCave",
      "https://wave.sndcdn.com/VMW74xQtu7Ea_m.json",
      ["15"],
    ],
    [
      "Techno Temple",
      "technoTemple",
      "https://wave.sndcdn.com/2MUwA6RIJ3EC_m.json",
      ["16-1"],
    ],
    [
      "Techno Temple Night",
      "",
      "https://wave.sndcdn.com/uNbgPZZe6TR2_m.json",
      ["16-2"],
    ],
    [
      "Cave Crossroads",
      "caveCrossroads",
      "https://wave.sndcdn.com/tUydDmtnA5JT_m.json",
      ["18"],
    ],
    [
      "Collapsed Tunnel",
      "collapsedTunnel",
      "https://wave.sndcdn.com/S9SerXgpQcNy_m.json",
      ["67"],
    ],
    [
      "Slippery Pit",
      "slipperyPit",
      "https://wave.sndcdn.com/Tcd5dkaUIhuN_m.json",
      ["68"],
    ],
    [
      "Lotus Pool",
      "lotusPool",
      "https://wave.sndcdn.com/AbeDMADxKbp8_m.json",
      ["69"],
    ],
    [
      "Still Stream",
      "stillStream",
      "https://wave.sndcdn.com/fyKOGLYuKTKe_m.json",
      ["70"],
    ],
    [
      "Shabby Deck",
      "shabbyDeck",
      "https://wave.sndcdn.com/c1ebQEP44zkf_m.json",
      ["71"],
    ],
    [
      "Abandoned Room",
      "hatchToNowhere",
      "https://wave.sndcdn.com/ivK9Ez1YPwob_m.json",
      ["72"],
    ],
    [
      "Broken Tube",
      "brokenTube",
      "https://wave.sndcdn.com/F1K79MKfXaz6_m.json",
      ["73"],
    ],
    [
      "Engraved Door",
      "engravedDoor",
      "https://wave.sndcdn.com/bING54ldGzhy_m.json",
      ["74"],
    ],
    [
      "Temple of the Wheel",
      "templeOfTheWheel",
      "https://wave.sndcdn.com/gqJEvZPa17x8_m.json",
      ["19"],
    ],
    [
      "Flood Mural",
      "floodMural",
      "https://wave.sndcdn.com/jKT9ufFHR32u_m.json",
      ["75"],
    ],
    [
      "Caer Golud",
      "sextantRooms",
      "https://wave.sndcdn.com/hyl2ZG8hYaaa_m.json",
      ["88", "89"],
    ],
    [
      "Scenic View",
      "scenicView",
      "https://wave.sndcdn.com/R3NJLYzil4FG_m.json",
      ["90"],
    ],
    [
      "Fungus Garden",
      "fungusGarden",
      "https://wave.sndcdn.com/HJ7vINGTtBda_m.json",
      ["76"],
    ],
    [
      "Thriving Mushrooms",
      "thrivingMushrooms",
      "https://wave.sndcdn.com/claSshTMHzF2_m.json",
      ["77"],
    ],
    [
      "Abandoned Camp",
      "abandonedCamp",
      "https://wave.sndcdn.com/BTIKtE6kmAC1_m.json",
      ["79"],
    ],
    [
      "Toadstool Platforms",
      "toadstoolPlatforms",
      "https://wave.sndcdn.com/quq6pCyYAeKC_m.json",
      ["78"],
    ],

    [
      "Radiant Crystal",
      "radiantCrystal",
      "https://wave.sndcdn.com/xsiBXRc6wEnf_m.json",
      ["80"],
    ],
    [
      "Charcoal Mural",
      "charcoalMural",
      "https://wave.sndcdn.com/4S2wCqmwdPz7_m.json",
      ["81"],
    ],
    [
      "Geometric Cliffs",
      "geometricCliffs",
      "https://wave.sndcdn.com/jjUNBD0Bq5Zr_m.json",
      ["82"],
    ],
    [
      "Reinforced Tunnel",
      "reinforcedTunnel",
      "https://wave.sndcdn.com/zqRfzpW8E1lU_m.json",
      ["84"],
    ],
    [
      "Canyon Bridge",
      "canyonBridge",
      "https://wave.sndcdn.com/nyaQCyrq8xrf_m.json",
      ["83"],
    ],
    [
      "Giants Palm",
      "giantsPalm",
      "https://wave.sndcdn.com/R5ewZLb9IX1Q_m.json",
      ["85"],
    ],
    [
      "Sacrarium",
      "sacrarium",
      "https://wave.sndcdn.com/CbfSpA7q3O16_m.json",
      ["87"],
    ],
    [
      "Guardian Skull",
      "guardianSkull",
      "https://wave.sndcdn.com/UconLwz2A4ya_m.json",
      ["86"],
    ],
  ];

  const BASE_IMG_URL =
    "https://raw.githubusercontent.com/Asphodel-OS/kamigotchi/refs/heads/main/packages/client/src/assets/images/rooms/";

  const ROOM_IMAGES = {
    "00": ["0_loading/backgrounds/playtest.png"],
    "01": ["1_misty-river/backgrounds/playtest.png"],
    "02-1": [
      "2_tree-tunnel/backgrounds/glow-a.png",
      "2_tree-tunnel/backgrounds/glow-b.png",
      "2_tree-tunnel/backgrounds/room2a1-christmas.png",
      "2_tree-tunnel/backgrounds/room2b1-christmas.png",
    ],
    "03-1": [
      "3_gate/backgrounds/room3a_zev.png",
      "3_gate/backgrounds/room3b_zev.png",
    ],
    "02-2": [
      "2_tree-tunnel/backgrounds/glow-c.png",
      "2_tree-tunnel/backgrounds/room2c1-christmas.png",
    ],
    "03-2": ["3_gate/backgrounds/room3c_zev.png"],
    "04": [
      "4_junkyard/backgrounds/room4a.gif",
      "4_junkyard/backgrounds/room4b.gif",
      "4_junkyard/backgrounds/room4c.gif",
    ],
    "05-1": [
      "5_restricted/backgrounds/room5a_rob.png",
      "5_restricted/backgrounds/room5b_rob.png",
    ],
    "06-1": [
      "6_office-front/backgrounds/room6a.gif",
      "6_office-front/backgrounds/room6b.gif",
    ],
    "05-2": ["5_restricted/backgrounds/room5c_rob.png"],
    "06-2": ["6_office-front/backgrounds/room6c.gif"],
    "09": [
      "9_forest/backgrounds/playtest-a.png",
      "9_forest/backgrounds/playtest-b.png",
      "9_forest/backgrounds/playtest-c.png",
    ],
    33: [
      "33_forest-entrance/backgrounds/playtest-a.png",
      "33_forest-entrance/backgrounds/playtest-b.png",
      "33_forest-entrance/backgrounds/playtest-c.png",
    ],
    36: [
      "36_forest-road-ii/backgrounds/playtest-a.png",
      "36_forest-road-ii/backgrounds/playtest-b.png",
      "36_forest-road-ii/backgrounds/playtest-c.png",
    ],
    48: [
      "48_forest-road-iv/backgrounds/playtest-a.png",
      "48_forest-road-iv/backgrounds/playtest-b.png",
      "48_forest-road-iv/backgrounds/playtest-c.png",
    ],
    10: [
      "10_forest-insect/backgrounds/playtest-a.png",
      "10_forest-insect/backgrounds/playtest-b.png",
      "10_forest-insect/backgrounds/playtest-c.png",
    ],
    35: [
      "35_forest-road-i/backgrounds/playtest-a.png",
      "35_forest-road-i/backgrounds/playtest-b.png",
      "35_forest-road-i/backgrounds/playtest-c.png",
    ],
    50: [
      "50_ancient_forest_entrance/backgrounds/playtest-a.png",
      "50_ancient_forest_entrance/backgrounds/playtest-b.png",
      "50_ancient_forest_entrance/backgrounds/playtest-c.png",
    ],
    51: [
      "51_scrap_littered_undergrowth/backgrounds/playtest-a.png",
      "51_scrap_littered_undergrowth/backgrounds/playtest-b.png",
      "51_scrap_littered_undergrowth/backgrounds/playtest-c.png",
    ],
    61: [
      "61_decaying-forest-path/backgrounds/room61a.png",
      "61_decaying-forest-path/backgrounds/room61b.png",
      "61_decaying-forest-path/backgrounds/room61c.png",
    ],
    11: [
      "11_waterfall/backgrounds/playtest-a.png",
      "11_waterfall/backgrounds/playtest-b.png",
      "11_waterfall/backgrounds/playtest-c.png",
    ],
    12: [
      "12_junkyard-machine/backgrounds/playtest-a.png",
      "12_junkyard-machine/backgrounds/playtest-b.png",
      "12_junkyard-machine/backgrounds/playtest-c.png",
    ],
    34: [
      "34_deeper-into-scrap/backgrounds/playtest-a.png",
      "34_deeper-into-scrap/backgrounds/playtest-b.png",
      "34_deeper-into-scrap/backgrounds/playtest-c.png",
    ],
    58: [
      "58_mouth-of-scrap/backgrounds/room58a.png",
      "58_mouth-of-scrap/backgrounds/room58b.png",
      "58_mouth-of-scrap/backgrounds/room58c.png",
    ],
    60: [
      "60_scrap-trees/backgrounds/room60a.png",
      "60_scrap-trees/backgrounds/room60b.png",
      "60_scrap-trees/backgrounds/room60c.png",
    ],
    13: ["13_giftshop/backgrounds/playtest.png"],
    25: [
      "25_lost-skeleton/backgrounds/playtest-a.png",
      "25_lost-skeleton/backgrounds/playtest-b.png",
      "25_lost-skeleton/backgrounds/playtest-c.png",
    ],
    37: [
      "37_forest-road-iii/backgrounds/playtest-a.png",
      "37_forest-road-iii/backgrounds/playtest-b.png",
      "37_forest-road-iii/backgrounds/playtest-c.png",
    ],
    49: [
      "49_clearing/backgrounds/room49a2.png",
      "49_clearing/backgrounds/room49b2.png",
      "49_clearing/backgrounds/room49c2.png",
    ],
    26: [
      "26_trash-strewn-graves/backgrounds/playtest-a.png",
      "26_trash-strewn-graves/backgrounds/playtest-b.png",
      "26_trash-strewn-graves/backgrounds/playtest-c.png",
    ],
    53: [
      "53_blooming-tree/backgrounds/playtest-a.png",
      "53_blooming-tree/backgrounds/playtest-b.png",
      "53_blooming-tree/backgrounds/playtest-c.png",
    ],
    29: [
      "29_road-out-of-woods/backgrounds/playtest-a.png",
      "29_road-out-of-woods/backgrounds/playtest-b.png",
      "29_road-out-of-woods/backgrounds/playtest-c.png",
      "29_road-out-of-woods/backgrounds/room29c-christmas.gif",
    ],
    30: [
      "30_scrapyard-entrance/backgrounds/playtest-a.png",
      "30_scrapyard-entrance/backgrounds/playtest-b.png",
      "30_scrapyard-entrance/backgrounds/playtest-c.png",
    ],
    31: [
      "31_scrapyard-exit/backgrounds/playtest-a.png",
      "31_scrapyard-exit/backgrounds/playtest-b.png",
      "31_scrapyard-exit/backgrounds/playtest-c.png",
    ],
    32: [
      "32_road-to-labs/backgrounds/playtest-a.png",
      "32_road-to-labs/backgrounds/playtest-b.png",
      "32_road-to-labs/backgrounds/playtest-c.png",
    ],
    47: [
      "47_scrap-paths/backgrounds/playtest-a.png",
      "47_scrap-paths/backgrounds/playtest-b.png",
      "47_scrap-paths/backgrounds/playtest-c.png",
    ],
    52: [
      "52_airplane_crash/backgrounds/playtest-a.png",
      "52_airplane_crash/backgrounds/playtest-b.png",
      "52_airplane_crash/backgrounds/playtest-c.png",
    ],
    54: [
      "54_plane_interior/backgrounds/playtest-a.png",
      "54_plane_interior/backgrounds/playtest-b.png",
      "54_plane_interior/backgrounds/playtest-c.png",
    ],
    55: [
      "55_shady-path/backgrounds/room55a.png",
      "55_shady-path/backgrounds/room55b.png",
      "55_shady-path/backgrounds/room55c.png",
      "55_shady-path/backgrounds/room55c-christmas.gif",
    ],
    56: [
      "56_butterfly-forest/backgrounds/room56a.png",
      "56_butterfly-forest/backgrounds/room56b.png",
      "56_butterfly-forest/backgrounds/room56c.png",
      "56_butterfly-forest/backgrounds/room56c-christmas.gif",
    ],
    57: [
      "57_river-crossing/backgrounds/room57a.gif",
      "57_river-crossing/backgrounds/room57b.gif",
      "57_river-crossing/backgrounds/room57c.gif",
      "57_river-crossing/backgrounds/room57c-christmas.gif",
    ],
    63: [
      "63_deeper-forest-paths/backgrounds/room63a.png",
      "63_deeper-forest-paths/backgrounds/room63b.png",
      "63_deeper-forest-paths/backgrounds/room63c.png",
    ],
    19: ["19_temple-of-the-wheel/backgrounds/room19a.png"],
    62: [
      "62_centipedes/backgrounds/room62a.png",
      "62_centipedes/backgrounds/room62b.png",
      "62_centipedes/backgrounds/room62c.png",
    ],
    64: [
      "64_burning-room/backgrounds/room64a.gif",
      "64_burning-room/backgrounds/room64b.gif",
      "64_burning-room/backgrounds/room64c.gif",
    ],
    65: [
      "65_forest-hut/backgrounds/room65a.png",
      "65_forest-hut/backgrounds/room65b.png",
      "65_forest-hut/backgrounds/room65c.png",
    ],
    66: [
      "66_trading-room/backgrounds/room66a.png",
      "66_trading-room/backgrounds/room66b.png",
      "66_trading-room/backgrounds/room66c.png",
    ],
    "16-1": [
      "16_techno-temple/backgrounds/room16a.png",
      "16_techno-temple/backgrounds/room16-christmas.png",
    ],
    "16-2": [
      "https://i1.sndcdn.com/artworks-JSdMqx23vi6PxXWg-BjkRYg-t1080x1080.jpg",
    ],
    18: ["18_cave-crossroads/backgrounds/room18c.png"],
    67: [
      "67_boulder-tunnel/backgrounds/room67b.png",
      "67_boulder-tunnel/backgrounds/room67b-christmas.png",
    ],
    68: [
      "68_slippery-pit/backgrounds/room68.png",
      "68_slippery-pit/backgrounds/room68-christmas.png",
    ],
    69: [
      "69_lotus-pool/backgrounds/room69.png",
      "69_lotus-pool/backgrounds/room69-christmas.png",
    ],
    70: [
      "70_still-stream/backgrounds/room70.png",
      "70_still-stream/backgrounds/room70-christmas.png",
    ],
    71: [
      "71_shabby-deck/backgrounds/room71.png",
      "71_shabby-deck/backgrounds/room71-christmas.png",
    ],
    72: ["72_hatch-to-nowhere/backgrounds/room72.png"],
    73: ["73_broken-tube/backgrounds/room73.png"],
    74: [
      "74_engraved-door/backgrounds/room74a.png",
      "74_engraved-door/backgrounds/room74b.png",
    ],
    75: ["75_flood-mural/backgrounds/room75.png"],
    88: ["88_treasure-hoard/backgrounds/room88.png"],
    89: ["89_trophies-of-the-hunt/backgrounds/room89a.png"],
    90: ["90_scenic-view/backgrounds/room90.png"],
    76: ["76_fungus-garden/backgrounds/room76.png"],
    77: ["77_thriving-mushrooms/backgrounds/room77b.png"],
    79: ["79_abandoned-campsite/backgrounds/room79.png"],
    78: ["78_toadstool-platforms/backgrounds/room78.png"],
    80: ["80_radiant-crystal/backgrounds/room80.png"],
    81: ["81_flower-mural/backgrounds/room81.png"],
    82: ["82_geometric-cliffs/backgrounds/room82.png"],
    84: ["84_reinforced-tunnel/backgrounds/room84.png"],
    83: ["83_canyon-bridge/backgrounds/room83.png"],
    85: ["85_giants-palm/backgrounds/room85a.png"],
    87: ["87_sacrarium/backgrounds/room87.png"],
    86: ["86_guardian-skull/backgrounds/room86.png"],
  };

  // Pre-build artwork override map: title -> image URL array.
  const artworkOverrides = {};
  for (const [title, , , roomIds] of PLAYLIST) {
    const images = [];
    for (const id of roomIds) {
      const paths = ROOM_IMAGES[id];
      if (paths) paths.forEach((p) => images.push(BASE_IMG_URL + p));
    }
    if (images.length > 0) artworkOverrides[title] = images;
  }

  artworkOverrides["Techno Temple Night"] = [
    `${R2_BASE_URL}/images/techno-temple-night.png`,
  ];

  // ── TOGGLE BUTTON ─────────────────────────────────────────
  const scToggleBtn = document.getElementById("sc-toggle-btn");
  if (scToggleBtn) {
    if (!document.getElementById("sc-loading-hint-style")) {
      const s = document.createElement("style");
      s.id = "sc-loading-hint-style";
      s.textContent = `#sc-loading-hint{position:absolute;bottom:calc(100% + 1px);left:50%;transform:translateX(-50%);font-size:9px;white-space:nowrap;color:#000;pointer-events:none;opacity:0;transition:opacity 0.2s ease;}#sc-loading-hint.visible{opacity:1;}`;
      document.head.appendChild(s);
    }
    if (!document.getElementById("sc-visualizer-style")) {
      const s = document.createElement("style");
      s.id = "sc-visualizer-style";
      s.textContent = `
        .sc-visualizer{display:inline-flex;align-items:flex-end;gap:2px;height:8px;margin:0 2px 5px 0;vertical-align:middle;flex-shrink:0;overflow:visible;color:#888;}
        .sc-visualizer .sc-vis-bar{width:3px;height:8px;border-radius:1px;background:currentColor;transform-origin:bottom;transition:transform 0.15s ease,opacity 0.4s ease;}
        .sc-title-wrapper{display:flex;align-items:center;}
        @keyframes sc-vis-load{0%,100%{opacity:0.25}50%{opacity:0.75}}
        .sc-visualizer[data-vis-state="loading"] .sc-vis-bar { animation: sc-vis-load 1.2s ease-in-out infinite; }
        .sc-visualizer[data-vis-state="loading"] .sc-vis-bar:nth-child(2) { animation-delay: 0.8s; }
        .sc-visualizer[data-vis-state="loading"] .sc-vis-bar:nth-child(3) { animation-delay: 0.4s; }
        .sc-visualizer[data-vis-state="paused"] .sc-vis-bar{transition:transform 0.4s ease,opacity 0.4s ease;transform:scaleY(0)!important;opacity:0.4;}
        .sc-visualizer[data-vis-state="idle"] .sc-vis-bar{transform:scaleY(0)!important;opacity:0;}
      `;
      document.head.appendChild(s);
    }
    const hint = document.createElement("div");
    hint.id = "sc-loading-hint";
    hint.textContent = "loading";
    scToggleBtn.style.position = "relative";
    scToggleBtn.appendChild(hint);

    scToggleBtn.addEventListener("click", () => {
      const player = document.getElementById("soundcloud-player");
      if (player.classList.contains("sc-open")) {
        player.classList.remove("sc-open");
        if (player._artworkInterval) {
          clearInterval(player._artworkInterval);
          player._artworkInterval = null;
        }
        return;
      }
      const artwork = player.querySelector(".sc-artwork");
      if (!artwork) {
        player.classList.add("sc-open");
        return;
      }
      if (
        artwork.src &&
        artwork.src !== window.location.href &&
        artwork.complete
      ) {
        player.classList.add("sc-open");
        return;
      }
      hint.classList.add("visible");
      const onLoad = () => {
        artwork.removeEventListener("error", onError);
        hint.classList.remove("visible");
        player.classList.add("sc-open");
      };
      const onError = () => {
        artwork.removeEventListener("load", onLoad);
        hint.classList.remove("visible");
        player.classList.add("sc-open");
      };
      artwork.addEventListener("load", onLoad, { once: true });
      artwork.addEventListener("error", onError, { once: true });
    });
  }

  // ── IPOD SHELL ────────────────────────────────────────────
  const scContainer = document.getElementById("soundcloud-player");
  if (!scContainer) return;

  const panel = scContainer.querySelector(".sc-panel");
  if (panel && !panel.dataset.ipod) {
    panel.dataset.ipod = "true";

    const kamiLink = document.createElement("a");
    kamiLink.href = "https://app.kamigotchi.io";
    kamiLink.target = "_blank";
    kamiLink.className = "sc-kami-corner-link";
    const kamiImg = document.createElement("img");
    kamiImg.src =
      "https://pbs.twimg.com/profile_images/1886393558795513856/ZuXYVnfL_400x400.png";
    kamiImg.alt = "Kamigotchi";
    kamiLink.appendChild(kamiImg);

    const screen = document.createElement("div");
    screen.className = "sc-ipod-screen";
    const wheelContainer = document.createElement("div");
    wheelContainer.className = "sc-ipod-wheel-container";
    const wheel = document.createElement("div");
    wheel.className = "sc-ipod-wheel";
    const centerBtn = document.createElement("div");
    centerBtn.className = "sc-ipod-center-btn";

    const artworkWrap =
      panel.querySelector(".artwork-wrapper") ||
      panel.querySelector(".sc-artwork");
    const titleWrap = panel.querySelector(".sc-title-wrapper");
    const seekRow = panel.querySelector(".sc-seek-row");
    const controls = panel.querySelector(".sc-controls");

    if (artworkWrap) screen.appendChild(artworkWrap);
    if (titleWrap) screen.appendChild(titleWrap);
    if (seekRow) screen.appendChild(seekRow);
    if (controls) centerBtn.appendChild(controls);

    const menu = document.createElement("span");
    menu.className = "wheel-label top";
    menu.innerText = "MENU";
    const prev = document.createElement("span");
    prev.className = "wheel-label left";
    prev.innerText = `\u23EE\uFE0E`;
    const next = document.createElement("span");
    next.className = "wheel-label right";
    next.innerText = `\u23ED\uFE0E`;
    const play = document.createElement("span");
    play.className = "wheel-label bottom";
    play.innerText = `\u23F5\uFE0E\u23F8\uFE0E`;

    wheel._menuBtn = menu;
    wheel._prevBtn = prev;
    wheel._nextBtn = next;
    wheel._playBtn = play;
    wheel.append(menu, prev, next, play, centerBtn);
    wheelContainer.appendChild(wheel);
    panel.innerHTML = "";
    panel.appendChild(screen);
    panel.appendChild(wheelContainer);
    panel.appendChild(kamiLink);
  }

  // Native <audio> — replaces the SC iframe entirely. No subprocess cost.
  const audio = document.createElement("audio");
  audio.preload = "none"; // nothing buffered until user presses play
  audio.volume = 0.1;
  scContainer.appendChild(audio);

  const formatTime = (s) => {
    s = Math.floor(s);
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  };

  let titleWrapper = scContainer.querySelector(".sc-title-wrapper");
  if (!titleWrapper) {
    titleWrapper = document.createElement("div");
    titleWrapper.className = "sc-title-wrapper";
    const ipodScreen = scContainer.querySelector(".sc-ipod-screen");
    if (ipodScreen) ipodScreen.appendChild(titleWrapper);
  }
  const trackTitleEl = document.createElement("span");
  trackTitleEl.className = "sc-track-title";
  titleWrapper.appendChild(trackTitleEl);

  const visEl = document.createElement("span");
  visEl.className = "sc-visualizer";
  visEl.setAttribute("data-vis-state", "idle");
  visEl.setAttribute("aria-hidden", "true");
  for (let i = 0; i < 3; i++) {
    const bar = document.createElement("span");
    bar.className = "sc-vis-bar";
    visEl.appendChild(bar);
  }
  titleWrapper.appendChild(visEl);

  const seekBar = scContainer.querySelector(".sc-seek-bar");
  const seekCur = scContainer.querySelector(".sc-seek-current");
  const seekDur = scContainer.querySelector(".sc-seek-duration");
  const playBtn = scContainer.querySelector(".sc-btn-play");
  const centerBtn = scContainer.querySelector(".sc-ipod-center-btn");

  // ── ARTWORK ───────────────────────────────────────────────
  const artworkEl = scContainer.querySelector(".sc-artwork");
  if (artworkEl) artworkEl.style.imageRendering = "pixelated";

  let dotsContainer = null;
  if (artworkEl && !scContainer.querySelector(".sc-artwork-dots")) {
    const dc = document.createElement("div");
    dc.className = "sc-artwork-dots";
    dc.style.cssText =
      "position:absolute;bottom:0;left:50%;transform:translateX(-50%);display:none;justify-content:center;align-items:center;gap:5px;padding:1.5px 0;";
    if (!document.getElementById("sc-dots-style")) {
      const s = document.createElement("style");
      s.id = "sc-dots-style";
      s.textContent = `.sc-artwork-dot{width:4px;height:4px;border-radius:50%;background:rgba(255,255,255,0.75);cursor:pointer;transition:background .25s,transform .25s;flex-shrink:0}.sc-artwork-dot:hover{background:rgba(255,255,255,0.7)}.sc-artwork-dot.active{background:#fff;}`;
      document.head.appendChild(s);
    }
    artworkEl.insertAdjacentElement("afterend", dc);
    dotsContainer = scContainer.querySelector(".sc-artwork-dots");
  }

  scContainer._artworkInterval = null;
  let currentArtworkIndex = 0;
  let currentArtworkTitle = null;
  let _currentImages = null;
  const SWITCH_SPEED_MS = 5000;

  const updateDots = (activeIndex) => {
    if (!dotsContainer) return;
    dotsContainer.querySelectorAll(".sc-artwork-dot").forEach((dot, i) => {
      dot.classList.toggle("active", i === activeIndex);
    });
  };

  const buildDots = (images, activeIndex) => {
    if (!dotsContainer) return;
    dotsContainer.innerHTML = "";
    if (images.length <= 1) {
      dotsContainer.style.display = "none";
      return;
    }
    dotsContainer.style.display = "flex";
    images.forEach((_, i) => {
      const dot = document.createElement("span");
      dot.className = "sc-artwork-dot" + (i === activeIndex ? " active" : "");
      dot.addEventListener("click", () => {
        currentArtworkIndex = i;
        if (artworkEl) artworkEl.src = images[i];
        updateDots(i);
        if (scContainer._artworkInterval) {
          clearInterval(scContainer._artworkInterval);
          scContainer._artworkInterval = setInterval(() => {
            if (document.hidden) return;
            currentArtworkIndex =
              (currentArtworkIndex + 1) % _currentImages.length;
            if (artworkEl) artworkEl.src = _currentImages[currentArtworkIndex];
            updateDots(currentArtworkIndex);
          }, SWITCH_SPEED_MS);
        }
      });
      dotsContainer.appendChild(dot);
    });
  };

  const updateArtwork = (title) => {
    if (title === currentArtworkTitle) return;
    currentArtworkTitle = title;
    currentArtworkIndex = 0;
    clearInterval(scContainer._artworkInterval);
    scContainer._artworkInterval = null;
    _currentImages = null;

    const images = artworkOverrides[title];
    if (artworkEl) artworkEl.src = "";

    if (images && images.length > 0) {
      _currentImages = images;
      if (artworkEl) artworkEl.src = images[0];
      buildDots(images, 0);
      if (images.length > 1) {
        scContainer._artworkInterval = setInterval(() => {
          if (document.hidden) return;
          currentArtworkIndex =
            (currentArtworkIndex + 1) % _currentImages.length;
          if (artworkEl) artworkEl.src = _currentImages[currentArtworkIndex];
          updateDots(currentArtworkIndex);
        }, SWITCH_SPEED_MS);
      }
    } else {
      buildDots([], 0);
    }
  };

  // ── WAVEFORM ──────────────────────────────────────────────
  const waveformCache = new Map();
  let currentWaveform = null;
  const cachedVisBars = Array.from(visEl.querySelectorAll(".sc-vis-bar"));

  const fetchWaveform = (trackIndex) => {
    const waveformUrl = PLAYLIST[trackIndex][2];
    if (!waveformUrl) {
      currentWaveform = null;
      return;
    }
    if (waveformCache.has(trackIndex)) {
      currentWaveform = waveformCache.get(trackIndex);
      return;
    }
    fetch(waveformUrl)
      .then((r) => r.json())
      .then((data) => {
        const samples = data.samples;
        const sorted = [...samples].sort((a, b) => a - b);
        const p05 = sorted[Math.floor(sorted.length * 0.05)];
        const p95 = sorted[Math.floor(sorted.length * 0.95)];
        const range = p95 - p05 || 1;
        const stretched = samples.map((v) =>
          Math.min(1, Math.max(0, (v - p05) / range)),
        );
        const sMin = Math.min(...stretched);
        const sMax = Math.max(...stretched);
        const wf = stretched.map((v) =>
          Math.pow((v - sMin) / (sMax - sMin || 1), 0.4),
        );
        if (waveformCache.size >= 20)
          waveformCache.delete(waveformCache.keys().next().value);
        waveformCache.set(trackIndex, wf);
        if (currentTrackIndex === trackIndex) currentWaveform = wf;
      })
      .catch(() => {});
  };

  // ── PLAYBACK STATE ────────────────────────────────────────
  let currentTrackIndex = Math.floor(Math.random() * PLAYLIST.length);
  let userStartedPlayback = false;
  let isSeeking = false;
  let isPlaying = false;

  const loadTrack = (index, autoplay) => {
    currentTrackIndex = index;
    const [title, key] = PLAYLIST[index];
    audio.src = `${R2_BASE_URL}/audio/${title}.mp3`;
    audio.load();
    trackTitleEl.textContent = title;
    updateArtwork(title);
    currentWaveform = null;
    fetchWaveform(index);
    if (seekBar) seekBar.value = 0;
    if (seekCur) seekCur.textContent = "0:00";
    if (seekDur) seekDur.textContent = "0:00";
    scContainer.setAttribute("data-sc-state", "paused");
    if (autoplay) audio.play().catch(() => {});
  };

  // Show title + artwork on load; no audio fetched until play is pressed.
  const [initTitle] = PLAYLIST[currentTrackIndex];
  trackTitleEl.textContent = initTitle;
  updateArtwork(initTitle);
  scContainer.setAttribute("data-sc-state", "idle");
  scContainer.dataset.scReady = "true";

  // ── AUDIO EVENTS ──────────────────────────────────────────
  audio.addEventListener("play", () => {
    isPlaying = true;
    scContainer.setAttribute("data-sc-state", "playing");
    visEl.setAttribute("data-vis-state", "playing");
    if (playBtn) {
      playBtn.setAttribute("data-state", "playing");
      playBtn.setAttribute("aria-label", "Pause");
    }
  });

  audio.addEventListener("pause", () => {
    isPlaying = false;
    scContainer.setAttribute("data-sc-state", "paused");
    visEl.setAttribute("data-vis-state", "paused");
    if (playBtn) {
      playBtn.setAttribute("data-state", "paused");
      playBtn.setAttribute("aria-label", "Play");
    }
  });

  audio.addEventListener("ended", () => {
    loadTrack((currentTrackIndex + 1) % PLAYLIST.length, true);
  });

  audio.addEventListener("durationchange", () => {
    if (seekDur && isFinite(audio.duration))
      seekDur.textContent = formatTime(audio.duration);
  });

  audio.addEventListener("timeupdate", () => {
    if (isSeeking || !isFinite(audio.duration) || audio.duration === 0) return;
    const pos = audio.currentTime / audio.duration;
    if (seekBar) seekBar.value = pos * 100;
    if (seekCur) seekCur.textContent = formatTime(audio.currentTime);

    if (!isPlaying || document.hidden) return;

    // Buffering: check if buffered range covers current position.
    let isBuffering = false;
    if (audio.buffered.length > 0) {
      isBuffering =
        audio.buffered.end(audio.buffered.length - 1) < audio.currentTime + 0.5;
    }
    const targetState = isBuffering ? "loading" : "playing";
    if (visEl.getAttribute("data-vis-state") !== targetState) {
      visEl.setAttribute("data-vis-state", targetState);
    }

    if (!isBuffering && currentWaveform && currentWaveform.length > 0) {
      const wf = currentWaveform;
      const offsets = [-0.02, 0, 0.02];
      cachedVisBars.forEach((bar, i) => {
        const idx = Math.min(
          wf.length - 1,
          Math.max(0, Math.round((pos + offsets[i]) * (wf.length - 1))),
        );
        bar.style.transform = `scaleY(${(wf[idx] * 1.3).toFixed(3)})`;
        bar.style.opacity = Math.pow(wf[idx], 0.15).toFixed(3);
      });
    }
  });

  // ── CONTROLS ──────────────────────────────────────────────
  const startOrToggle = () => {
    if (audio.paused) {
      // If no track is loaded yet, load now.
      if (!audio.src || audio.src === window.location.href) {
        loadTrack(currentTrackIndex, true);
      } else {
        audio.play().catch(() => {});
      }
    } else {
      audio.pause();
    }
  };

  if (playBtn)
    playBtn.addEventListener("click", () => {
      userStartedPlayback = true;
      startOrToggle();
    });
  if (centerBtn)
    centerBtn.addEventListener("click", () => {
      if (trackListVisible) {
        selectHighlighted();
        return;
      }
      userStartedPlayback = true;
      startOrToggle();
    });

  // ── SEEK ──────────────────────────────────────────────────
  if (seekBar) {
    const getSeekRatio = (e) => {
      const rect = seekBar.getBoundingClientRect();
      return Math.min(1, Math.max(0, (e.clientX - rect.left) / rect.width));
    };
    seekBar.addEventListener("pointerdown", (e) => {
      isSeeking = true;
      seekBar.setPointerCapture(e.pointerId);
      const ratio = getSeekRatio(e);
      seekBar.value = ratio * 100;
      if (isFinite(audio.duration)) {
        audio.currentTime = ratio * audio.duration;
        if (seekCur) seekCur.textContent = formatTime(ratio * audio.duration);
      }
    });
    seekBar.addEventListener("pointermove", (e) => {
      if (!isSeeking) return;
      const ratio = getSeekRatio(e);
      seekBar.value = ratio * 100;
      if (isFinite(audio.duration)) {
        audio.currentTime = ratio * audio.duration;
        if (seekCur) seekCur.textContent = formatTime(ratio * audio.duration);
      }
    });
    seekBar.addEventListener("pointerup", () => {
      setTimeout(() => {
        isSeeking = false;
      }, 300);
    });
  }

  // ── WHEEL / NAV ───────────────────────────────────────────
  const wheel = scContainer.querySelector(".sc-ipod-wheel");
  const menuBtn = wheel && wheel._menuBtn;
  const prevBtn = wheel && wheel._prevBtn;
  const nextBtn = wheel && wheel._nextBtn;
  const playWheelBtn = wheel && wheel._playBtn;
  const screen = scContainer.querySelector(".sc-ipod-screen");

  let trackListEl = null;
  let trackListVisible = false;
  let highlightedIndex = currentTrackIndex;

  const scrollHighlightedIntoView = () => {
    if (!trackListEl) return;
    const el = trackListEl.querySelector(".highlighted");
    if (el) el.scrollIntoView({ block: "nearest" });
  };

  const buildTrackList = () => {
    if (!screen) return;
    if (trackListEl && trackListEl.isConnected) {
      trackListEl.querySelectorAll(".sc-ipod-tracklist-row").forEach((r) => {
        r.classList.toggle(
          "highlighted",
          parseInt(r.dataset.index, 10) === highlightedIndex,
        );
      });
      scrollHighlightedIntoView();
      return;
    }
    if (trackListEl) trackListEl.remove();
    trackListEl = document.createElement("div");
    trackListEl.className = "sc-ipod-tracklist";
    PLAYLIST.forEach(([title], i) => {
      const row = document.createElement("div");
      row.className =
        "sc-ipod-tracklist-row" +
        (i === highlightedIndex ? " highlighted" : "");
      row.dataset.index = i;
      const t = document.createElement("span");
      t.className = "sc-ipod-tracklist-title";
      t.textContent = title;
      const a = document.createElement("span");
      a.className = "sc-ipod-tracklist-arrow";
      a.textContent = "›";
      row.appendChild(t);
      row.appendChild(a);
      row.addEventListener("mouseenter", () => {
        trackListEl
          .querySelectorAll(".sc-ipod-tracklist-row")
          .forEach((r) => r.classList.remove("highlighted"));
        row.classList.add("highlighted");
        highlightedIndex = i;
      });
      row.addEventListener("click", () => {
        highlightedIndex = i;
        selectHighlighted();
      });
      trackListEl.appendChild(row);
    });
    screen.appendChild(trackListEl);
    scrollHighlightedIntoView();
  };

  const showTrackList = () => {
    if (!screen) return;
    screen.style.height = screen.offsetHeight + "px";
    screen.setAttribute("data-view", "tracklist");
    trackListVisible = true;
    highlightedIndex = currentTrackIndex;
    buildTrackList();
  };

  const hideTrackList = () => {
    if (!screen) return;
    screen.removeAttribute("data-view");
    screen.style.height = "";
    trackListVisible = false;
    if (trackListEl) {
      trackListEl.remove();
      trackListEl = null;
    }
  };

  const selectHighlighted = () => {
    if (!trackListVisible) return;
    userStartedPlayback = true;
    loadTrack(highlightedIndex, true);
    hideTrackList();
  };

  if (menuBtn)
    menuBtn.addEventListener("click", () => {
      if (trackListVisible) hideTrackList();
      else showTrackList();
    });
  if (prevBtn)
    prevBtn.addEventListener("click", () => {
      if (trackListVisible) {
        highlightedIndex =
          (highlightedIndex - 1 + PLAYLIST.length) % PLAYLIST.length;
        buildTrackList();
      } else loadTrack(Math.max(0, currentTrackIndex - 1), userStartedPlayback);
    });
  if (nextBtn)
    nextBtn.addEventListener("click", () => {
      if (trackListVisible) {
        highlightedIndex = (highlightedIndex + 1) % PLAYLIST.length;
        buildTrackList();
      } else
        loadTrack(
          (currentTrackIndex + 1) % PLAYLIST.length,
          userStartedPlayback,
        );
    });
  if (playWheelBtn)
    playWheelBtn.addEventListener("click", () => {
      userStartedPlayback = true;
      startOrToggle();
    });
});