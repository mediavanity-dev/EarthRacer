# EarthRacer: later

Ideas we agreed on but parked until the core driving game feels right.

## Journeys (travel while you're away)

**Done for public transport (Nov 2026):** board a bus, train, ferry or plane at a real stop and
travel in real time (fixed average speeds per mode times a typical detour; no routing service and
no Google Maps, whose API needs a paid key in the app and forbids storing results). You can get off
early at the point you'd have reached. What's below is still parked: driving your *own* vehicle
somewhere while the app is closed.

- Pick a destination; your vehicle travels there **in real time at real speed** while the app is
  closed. Come back tomorrow and you're 600 km down the road.
- Your position is just a function of the route and the clock (start time, route, vehicle speed),
  so it's light to store and needs no server.
- Gives the "you're stuck where you left off" rule its point: getting to Lisbon by Friday is a
  plan you make.
- Long-haul goals: London → Istanbul, Cape → Cairo, the Pan-American Highway, measured in weeks.
- Fuel stops, ferries and border crossings along the route become events you return to.
- **Open problem: routing.** The public OSRM / Valhalla / GraphHopper demo servers aren't for
  production apps. Options: limit Journeys to roads in loaded tiles, pay for a routing API, or
  host our own router.
- Train travel (along OSM railways) as an earned Journey type.

## Watching a train trip

Find a nice way to watch train journeys (buses and other trips have the seatback map). The trip
line is straight but real track curves, so a 3D side-window view would show the right region but
not the actual line. Ideas: follow OSM railway lines from the tiles near the route, or a
low-detail side view that doesn't claim to be the exact track.

## Meeting other players

- No teleporting means meeting a friend in the game takes real planning, which makes meetups
  worth something.
- Convoys: share a Journey with friends and arrive together.
- Relay deliveries: one player carries a package partway and hands it to another.
- Needs a small server (presence and handoffs), so it waits until the single-player game is
  proven.

## Also later

- Tractor-trailer (16 m: needs its own camera and turning rules).
- At scale (public launch): an on-demand caching proxy in front of Overpass (building detail) and
  Nominatim, keyed by tile, as OpenWorld's runbook describes.

- Raise the speed cap (90 km/h for now so map tiles can keep up) once loading is smarter:
  prefetching along the route, lower-detail tiles for motorways, a wider loaded area.
- Mountain passes, opening hours for deliveries (via Overpass, as in OpenWorld).
- More earned vehicles: tuk-tuk (Thailand), snowmobile (snowy areas), road train (outback),
  ferry passes on real `route=ferry` lines.
- iPhone app (Capacitor), following OpenWorld's path.

## Better forests and land cover where OpenStreetMap has none (investigated 2026-11-23)

ESA WorldCover (10 m, global, CC BY 4.0) would fill in forests, grassland, cropland, wetland and
bare ground where OSM has no land-cover polygons (common outside Europe). Drawing cost is the same
(trees are already instanced), but reading it needs a few range requests per tile and a GeoTIFF
decoder in the worker. Blocker: its S3 bucket sends no CORS header, so a browser can't read it
directly. Options: a small caching relay (same as the Overpass/Nominatim proxy idea), or a native
fetch in the iPhone app only (the website would then differ). Use it only where OSM has nothing.

## Multiplayer: see other players and bump into them (to do, Nov 2026)

- A small relay server (for example Cloudflare Durable Objects: pay per use, no machine to run).
  Players in the same map tile join one "room" and send position, heading and speed about five times
  a second; everyone else is drawn like traffic, smoothed between updates.
- Bumps reuse the traffic crash physics (momentum by vehicle weight). Each phone settles its own
  side of a bump: simple, and a rare disagreement doesn't matter in a casual game.
- Needs anonymous player IDs, name moderation, a privacy policy update (live positions are shared)
  and the App Privacy answers changed in App Store Connect and Play Console.

## PC split screen (to do)

- Two players on one computer: one on the keyboard, one on a controller (the input code already
  tells them apart). Two vehicles, two cameras, the screen split side by side.
- Drawing the world twice costs a lot: desktop only, with the Settings switch hidden on phones.

## Wording that reads as AI-written (to do)

- Players say some text sounds machine-written. Pull every player-facing string (toasts, menus,
  help, feats, store listing) into one list, mark the usual tells (dash asides, "not X but Y",
  lists of three, over-explaining, cute filler) and rewrite them in one plain, human voice, using
  real player comments as the reference.
- Then add a check that flags new strings with those patterns before a build.

## Mainland China (to do)

- Apple needs a security assessment and an AI-generated-content (AIGC) filing for China mainland
  (existing apps by Jan 31, 2027). Games also need a government licence (an ISBN number), which in
  practice means a Chinese publishing partner.
- The big blocker for EarthRacer: maps shown in China must come from licensed map providers;
  OpenStreetMap data isn't approved there. Research partner publishers and the map-licensing route
  before anything else.
