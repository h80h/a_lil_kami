// ============================================================
// SOUNDCLOUD PLAYER (Custom UI via Widget API)
// The iframe is hidden offscreen — it drives audio only.
// #soundcloud-player is styled freely in your CSS.
// Data attribute exposed for styling hooks:
//   [data-sc-state="idle|playing|paused"]  on #soundcloud-player
// HTML elements expected in index.html:
//   .sc-title-wrapper  — container where the <select> dropdown is appended
//   .sc-seek-bar       — <input type="range"> seek slider
//   .sc-seek-current   — elapsed time label
//   .sc-seek-duration  — total duration label
//   .sc-btn-play       — play/pause toggle button
// ============================================================

document.addEventListener("DOMContentLoaded", () => {
  const scToggleBtn = document.getElementById("sc-toggle-btn");
  if (scToggleBtn) {
    // Inject loading hint styles once
    if (!document.getElementById("sc-loading-hint-style")) {
      const s = document.createElement("style");
      s.id = "sc-loading-hint-style";
      s.textContent = `#sc-loading-hint{position:absolute;bottom:calc(100% + 1px);left:50%;transform:translateX(-50%);font-size:9px;white-space:nowrap;color:#000;pointer-events:none;opacity:0;transition:opacity 0.2s ease;}#sc-loading-hint.visible{opacity:1;}`;
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
        return;
      }
      const artwork = player.querySelector(".sc-artwork");
      if (!artwork) {
        player.classList.add("sc-open");
        return;
      }
      // Already loaded (cached or complete)
      if (
        artwork.src &&
        artwork.src !== window.location.href &&
        artwork.complete
      ) {
        player.classList.add("sc-open");
        return;
      }
      // Show loading hint while waiting
      hint.classList.add("visible");
      // Wait for the next load event — covers both: src already set but loading,
      // and src not yet set (updateArtwork will set it shortly after widget READY)
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

  const scContainer = document.getElementById("soundcloud-player");
  if (scContainer) {
    // Hidden iframe — audio engine only
    const scIframe = document.createElement("iframe");
    scIframe.id = "sc-hidden-iframe";
    scIframe.allow = "autoplay";
    scIframe.src =
      "https://w.soundcloud.com/player/?url=https%3A//soundcloud.com/asphodel-332772510/sets/complete-soundtrack&auto_play=false&hide_related=true&show_comments=false&show_user=true&show_reposts=false";
    Object.assign(scIframe.style, {
      position: "absolute",
      width: "1px",
      height: "1px",
      top: "-9999px",
      left: "-9999px",
      visibility: "hidden",
      pointerEvents: "none",
    });
    scContainer.appendChild(scIframe);

    const formatTime = (ms) => {
      const s = Math.floor(ms / 1000);
      return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
    };

    const titleWrapper = scContainer.querySelector(".sc-title-wrapper");
    const seekBar = scContainer.querySelector(".sc-seek-bar");
    const seekCur = scContainer.querySelector(".sc-seek-current");
    const seekDur = scContainer.querySelector(".sc-seek-duration");
    const playBtn = scContainer.querySelector(".sc-btn-play");

    // Load Widget API script once, then init
    const initWidget = () => {
      const BASE_IMG_URL =
        "https://raw.githubusercontent.com/Asphodel-OS/kamigotchi/refs/heads/main/packages/client/src/assets/images/rooms/";
      const trackKeyMap = {
        arrival: ["Arrival", ["00", "01", "02-1", "03-1"]],
        arrivalNight: ["Arrival Night", ["02-2", "03-2"]],
        mystique: ["Mystique", ["04"]],
        amusement: ["Amusement", ["05-1", "06-1"]],
        amusementNight: ["Amusement Night", ["05-2", "06-2"]], // Fixed missing array brackets here
        k11: ["Forest", ["09", "33", "36", "48"]],
        k4: ["Musty Forest Path", ["10", "35", "50", "51", "61"]],
        glitter: ["Glitter", ["11"]],
        k1: ["Deeper into the Scrap", ["12", "34", "58", "60"]],
        mina: ["Mina's Shop", ["13"]],
        templeCave: ["Temple Cave", ["15"]],
        technoTemple: ["Techno Temple", ["16"]],
        caveCrossroads: ["Cave Crossroads", ["18"]],
        templeOfTheWheel: ["Temple of the Wheel", ["19"]],
        k13: ["Lost Skeleton", ["25", "37", "49"]],
        k9: ["Trash-Strewn Graves", ["26", "53"]],
        cave: ["Cave", ["29", "30", "31", "32", "47"]],
        k2: ["Airplane", ["52", "54"]],
        k8: ["Butterfly Forest", ["55", "56", "57", "63"]],
        // "k14": ["Black Pool", ['59']],
        k5: ["Centipedes", ["62"]],
        k3: ["Forest Hut", ["64", "65"]],
        market: ["Market", ["66"]],
        collapsedTunnel: ["Collapsed Tunnel", ["67"]],
        slipperyPit: ["Slippery Pit", ["68"]],
        lotusPool: ["Lotus Pool", ["69"]],
        stillStream: ["Still Stream", ["70"]],
        shabbyDeck: ["Shabby Deck", ["71"]],
        hatchToNowhere: ["Abandoned Room", ["72"]],
        brokenTube: ["Broken Tube", ["73"]],
        engravedDoor: ["Engraved Door", ["74"]],
        floodMural: ["Flood Mural", ["75"]],
        fungusGarden: ["Fungus Garden", ["76"]],
        thrivingMushrooms: ["Thriving Mushrooms", ["77"]],
        toadstoolPlatforms: ["Toadstool Platforms", ["78"]],
        abandonedCamp: ["Abandoned Camp", ["79"]],
        radiantCrystal: ["Radiant Crystal", ["80"]],
        charcoalMural: ["Charcoal Mural", ["81"]],
        geometricCliffs: ["Geometric Cliffs", ["82"]],
        canyonBridge: ["Canyon Bridge", ["83"]],
        reinforcedTunnel: ["Reinforced Tunnel", ["84"]],
        giantsPalm: ["Giants Palm", ["85"]],
        guardianSkull: ["Guardian Skull", ["86"]],
        sacrarium: ["Sacrarium", ["87"]],
        sextantRooms: ["Caer Golud", ["88", "89"]],
        scenicView: ["Scenic View", ["90"]],
      };

      const roomMap = {
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
      };

      // 1. Build the artworkOverrides dictionary to hold ARRAYS of images
      const artworkOverrides = {};

      Object.values(trackKeyMap).forEach((trackData) => {
        const trackTitle = trackData[0]; // e.g. "Arrival"
        const roomIds = trackData[1]; // e.g. ['00', '01', '02-1', '03-1']
        const imagesForTrack = [];

        // Loop through all rooms assigned to this track
        for (const roomId of roomIds) {
          if (roomMap[roomId] && roomMap[roomId].length > 0) {
            // Push ALL image variants for this room into our pool
            roomMap[roomId].forEach((imagePath) => {
              imagesForTrack.push(BASE_IMG_URL + imagePath);
            });
          }
        }

        // Only save it if we actually found images
        if (imagesForTrack.length > 0) {
          artworkOverrides[trackTitle] = imagesForTrack;
        }
      });

      // 2. Global variables to keep track of the timer and current image
      let artworkInterval = null;
      let currentArtworkIndex = 0;
      let currentArtworkTitle = null;
      const SWITCH_SPEED_MS = 5000; // Change image every 5 seconds

      // Dots container injected once, positioned below .sc-artwork
      let dotsContainer = null;

      const renderDots = (images, activeIndex) => {
        if (!dotsContainer) return;
        dotsContainer.innerHTML = "";
        if (images.length <= 1) {
          dotsContainer.style.display = "none";
          return;
        }
        dotsContainer.style.display = "flex";
        images.forEach((_, i) => {
          const dot = document.createElement("span");
          dot.className =
            "sc-artwork-dot" + (i === activeIndex ? " active" : "");
          dot.addEventListener("click", () => {
            currentArtworkIndex = i;
            const artEl = scContainer.querySelector(".sc-artwork");
            if (artEl) artEl.src = images[i];
            renderDots(images, i);
          });
          dotsContainer.appendChild(dot);
        });
      };

      // 3. The updated updateArtwork function
      const updateArtwork = (sound) => {
        if (!sound) return;

        const images = artworkOverrides[sound.title];
        const artEl = scContainer.querySelector(".sc-artwork");

        // Reset cycling when track changes
        if (sound.title !== currentArtworkTitle) {
          currentArtworkTitle = sound.title;
          currentArtworkIndex = 0;
          clearInterval(artworkInterval);
          artworkInterval = null;
        }

        if (images && images.length > 0) {
          if (artEl) artEl.src = images[currentArtworkIndex];
          renderDots(images, currentArtworkIndex);

          // Start cycling only if more than one image and not already running
          if (images.length > 1 && !artworkInterval) {
            artworkInterval = setInterval(() => {
              currentArtworkIndex = (currentArtworkIndex + 1) % images.length;
              if (artEl) artEl.src = images[currentArtworkIndex];
              renderDots(images, currentArtworkIndex);
            }, SWITCH_SPEED_MS);
          }
        } else {
          // Fallback to default SoundCloud artwork if no override exists
          clearInterval(artworkInterval);
          artworkInterval = null;
          if (artEl && sound.artwork_url) {
            artEl.src = sound.artwork_url.replace("-large", "-t500x500");
          }
          renderDots([], 0);
        }
      };

      const artworkEl = scContainer.querySelector(".sc-artwork");
      if (artworkEl && !scContainer.querySelector(".sc-artwork-dots")) {
        const dc = document.createElement("div");
        dc.className = "sc-artwork-dots";
        dc.style.cssText =
          "display:flex;gap:6px;justify-content:center;align-items:center;flex-wrap:wrap;";

        if (!document.getElementById("sc-dots-style")) {
          const s = document.createElement("style");
          s.id = "sc-dots-style";
          s.textContent = `.sc-artwork-dot{width:7px;height:7px;border-radius:50%;background:rgba(255,255,255,0.35);cursor:pointer;transition:background .25s,transform .25s;flex-shrink:0}.sc-artwork-dot:hover{background:rgba(255,255,255,0.7)}.sc-artwork-dot.active{background:#fff;transform:scale(1.25)}`;
          document.head.appendChild(s);
        }
        artworkEl.insertAdjacentElement("afterend", dc);
        dotsContainer = scContainer.querySelector(".sc-artwork-dots");
      }

      const widget = SC.Widget(scIframe);
      let isSeeking = false;
      let cachedDuration = 0;
      let userStartedPlayback = false;

      widget.bind(SC.Widget.Events.READY, () => {
        scContainer.setAttribute("data-sc-state", "paused");
        widget.setVolume(10);
        // Build track dropdown and append into the existing .sc-title-wrapper
        const loadSounds = () => {
          widget.getSounds((sounds) => {
            const allLoaded = sounds.every((s) => s.title);
            if (!allLoaded) {
              setTimeout(loadSounds, 500);
              return;
            }

            const select = document.createElement("select");
            select.className = "sc-track-title";
            sounds.forEach((sound, i) => {
              const opt = document.createElement("option");
              opt.value = i;
              opt.textContent = sound.title;
              select.appendChild(opt);
            });
            select.addEventListener("change", () => {
              const index = parseInt(select.value);
              widget.skip(index);
              widget.play();
              updateArtwork(sounds[index]);
              if (seekDur)
                seekDur.textContent = formatTime(sounds[index].duration);
            });
            if (titleWrapper) titleWrapper.appendChild(select);
            scContainer._scSelect = select;
            scContainer.dataset.scReady = "true";

            const randomIndex = Math.floor(Math.random() * sounds.length);
            select.value = randomIndex;
            widget.skip(randomIndex);
            updateArtwork(sounds[randomIndex]);
            if (seekDur)
              seekDur.textContent = formatTime(sounds[randomIndex].duration);
          });
        };
        loadSounds();

        setTimeout(() => {
          widget.getDuration((d) => {
            if (d) {
              cachedDuration = d;
              if (seekDur) seekDur.textContent = formatTime(d);
            }
          });
        }, 1000);
      });

      widget.bind(SC.Widget.Events.PLAY, () => {
        scContainer.setAttribute("data-sc-state", "playing");
        if (!userStartedPlayback) {
          widget.pause();
          return;
        }
        if (playBtn) {
          playBtn.setAttribute("data-state", "playing");
          playBtn.innerHTML =
            '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 32 32"><path fill="currentColor" d="M14 10h-2v12h2zm6 0h-2v12h2z"/><path fill="currentColor" d="M16 4A12 12 0 1 1 4 16A12 12 0 0 1 16 4m0-2a14 14 0 1 0 14 14A14 14 0 0 0 16 2"/></svg>';
          playBtn.setAttribute("aria-label", "Pause");
        }
        widget.getCurrentSoundIndex((i) => {
          if (scContainer._scSelect) scContainer._scSelect.value = i;
        });
        widget.getCurrentSound((sound) => {
          updateArtwork(sound);
        });
        widget.getDuration((d) => {
          if (d) {
            cachedDuration = d;
            if (seekDur) seekDur.textContent = formatTime(d);
          }
        });
      });

      widget.bind(SC.Widget.Events.PAUSE, () => {
        scContainer.setAttribute("data-sc-state", "paused");
        if (playBtn) {
          playBtn.setAttribute("data-state", "paused");
          playBtn.innerHTML =
            '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 32 32"><path fill="currentColor" d="M11 23a1 1 0 0 1-1-1V10a1 1 0 0 1 1.447-.894l12 6a1 1 0 0 1 0 1.788l-12 6A1 1 0 0 1 11 23m1-11.382v8.764L20.764 16Z"/><path fill="currentColor" d="M16 4A12 12 0 1 1 4 16A12 12 0 0 1 16 4m0-2a14 14 0 1 0 14 14A14 14 0 0 0 16 2"/></svg>';
          playBtn.setAttribute("aria-label", "Play");
        }
      });

      widget.bind(SC.Widget.Events.FINISH, () => {
        scContainer.setAttribute("data-sc-state", "paused");
        if (playBtn) {
          playBtn.setAttribute("data-state", "paused");
          playBtn.innerHTML =
            '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 32 32"><path fill="currentColor" d="M11 23a1 1 0 0 1-1-1V10a1 1 0 0 1 1.447-.894l12 6a1 1 0 0 1 0 1.788l-12 6A1 1 0 0 1 11 23m1-11.382v8.764L20.764 16Z"/><path fill="currentColor" d="M16 4A12 12 0 1 1 4 16A12 12 0 0 1 16 4m0-2a14 14 0 1 0 14 14A14 14 0 0 0 16 2"/></svg>';
        }
        if (seekBar) seekBar.value = 0;
        if (seekCur) seekCur.textContent = "0:00";
      });

      widget.bind(SC.Widget.Events.PLAY_PROGRESS, (e) => {
        if (!isSeeking) {
          if (seekBar) seekBar.value = e.relativePosition * 100;
          if (seekCur) seekCur.textContent = formatTime(e.currentPosition);
        }
      });

      if (playBtn)
        playBtn.addEventListener("click", () => {
          userStartedPlayback = true;
          widget.toggle();
        });

      if (seekBar) {
        seekBar.addEventListener("mousedown", () => {
          isSeeking = true;
        });
        seekBar.addEventListener(
          "touchstart",
          () => {
            isSeeking = true;
          },
          { passive: true },
        );
        seekBar.addEventListener("input", () => {
          if (cachedDuration) {
            widget.seekTo((seekBar.value / 100) * cachedDuration);
            if (seekCur)
              seekCur.textContent = formatTime(
                (seekBar.value / 100) * cachedDuration,
              );
          }
        });
        seekBar.addEventListener("mouseup", () => {
          if (cachedDuration)
            widget.seekTo((seekBar.value / 100) * cachedDuration);
          setTimeout(() => {
            isSeeking = false;
          }, 300);
        });
        seekBar.addEventListener("touchend", () => {
          if (cachedDuration)
            widget.seekTo((seekBar.value / 100) * cachedDuration);
          setTimeout(() => {
            isSeeking = false;
          }, 300);
        });
      }
    };

    if (window.SC && window.SC.Widget) {
      initWidget();
    } else {
      const apiScript = document.createElement("script");
      apiScript.src = "https://w.soundcloud.com/player/api.js";
      apiScript.onload = initWidget;
      document.head.appendChild(apiScript);
    }
  }
});
