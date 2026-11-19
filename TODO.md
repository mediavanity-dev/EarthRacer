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

## Meeting other players

- No teleporting means meeting a friend in the game takes real planning, which makes meetups
  worth something.
- Convoys: share a Journey with friends and arrive together.
- Relay deliveries: one player carries a package partway and hands it to another.
- Needs a small server (presence and handoffs), so it waits until the single-player game is
  proven.

## Also later

- Raise the speed cap (90 km/h for now so map tiles can keep up) once loading is smarter:
  prefetching along the route, lower-detail tiles for motorways, a wider loaded area.
- Mountain passes, opening hours for deliveries (via Overpass, as in OpenWorld).
- More earned vehicles: tuk-tuk (Thailand), snowmobile (snowy areas), road train (outback),
  ferry passes on real `route=ferry` lines.
- iPhone app (Capacitor), following OpenWorld's path.
