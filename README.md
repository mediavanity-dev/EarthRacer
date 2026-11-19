# EarthRacer (prototype)

Drive, ride and sail the real Earth, built live from open map data. Real streets, real speeds,
real weather, real day and night.

**▶ Play: https://mediavanity-dev.github.io/EarthRacer/** (phones and computers, nothing to install)

## The rules

- **You carry on from where you last stopped.** No teleporting. Your spot is saved on your device.
- **Trips:** at a real bus stop, train station, ferry terminal or airport, take a trip somewhere and
  wait in real time (the app can be closed). Get off early to be dropped where you'd have got to.
- **Random placement**, as often as you like: get dropped somewhere on Earth with the labels
  hidden, read the street names and signs, and guess where you are. Wherever you land becomes your
  new spot.
- **Real-world speeds**, all held to 90 km/h for now so the map can load ahead in time (see
  [TODO.md](TODO.md)).

## Things to do

| | |
|---|---|
| 📦 Jobs | Deliveries from real shops and cafés across town, against the clock. Same jobs for everyone in an area each day. |
| 🏁 Races | A daily route through real streets in each area, with gates and your own ghost. |
| 🛣️ Street atlas | Every named street you drive, per area. |
| 🌉 Bridges, 📮 postcards, 🌍 countries | Collected as you go. Postcards come from Wikipedia (free-licence photos only). |
| ✨ Style | Near misses, drifts, overtakes, slipstreams, airtime and clean kilometres build a combo; crashes break it. |
| ⛽ Fuel | Tanks run down at realistic rates; stop at real fuel stations (⛽ on the minimap) to refill. |

Vehicles: 🚲 bicycle and 🚗 car to start; 🚚 delivery truck after 3 deliveries; 🚤 speedboat
after you reach the water's edge; 🪂 paramotor (powered paraglider, ~40 km/h, takes off from parks
and open fields) after finishing 3 daily races. Cameras: chase, far, bumper and top-down.

## Controls

- **Keyboard:** W/S or arrows to drive and brake/reverse, A/D to steer, Space handbrake, C camera,
  H horn, R back to the road, J jobs, Esc menu, M sound.
- **Game controller** (Xbox and other standard pads, wired or Bluetooth): RT gas, LT brake, left
  stick steer, A handbrake, Y camera, X horn, B back to the road, Menu button = menu. It rumbles on
  crashes and near misses.
- **Phone** (choose in Settings): **Tilt** — hold the phone like a steering wheel, brake under your
  left thumb and gas under your right; a two-tap calibration sets the centre and direction.
  **Slider** — drag to steer. **Buttons** — ◀ ▶.

## Real conditions (open data)

| Source | Used for |
|---|---|
| OpenStreetMap via OpenFreeMap vector tiles | Roads (class, surface, bridges, one-way), buildings, water, land use, shops, landmarks, fuel stations, street names |
| AWS Terrain Tiles (Mapzen) | Hills, crests and airtime |
| Open-Meteo | Live weather: rain and snow cut grip, fog shortens the view, wind slows bikes and boats |
| Open-Meteo Marine | Wave height at sea: boats pitch and lose grip in a swell |
| SunCalc (on the device) | Real sun position: day, dusk, night, headlights, lit windows |
| Nominatim (OSM) | Country (traffic drives on the correct side, mph or km/h), place search, guesses |
| Wikipedia / Wikimedia Commons | Landmark postcards |

## For developers

```
npm install
npm run dev                 # http://localhost:5173
npm run build               # -> dist/
```

Pushing to `main` builds and deploys to GitHub Pages ([.github/workflows/pages.yml](.github/workflows/pages.yml)).

Dev switches (add to the URL): `?dev&at=lat,lon` starts at a spot (ignores the saved one),
`&v=bike|car|truck|boat`, `&hour=12` forces the UTC hour for lighting, `&touch` forces the phone
controls, `&timer` runs the loop on a timer (for testing in a background window).

### Layout

```
src/main.js            renderer, game loop, camera, scoring, activities, menus
src/input.js           keyboard, gamepad, touch (tilt / slider / buttons)
src/audio.js           synthesised engine, tyres, wind, rain, crashes, chimes
src/world/worker.js    builds a map tile: terrain, roads with markings, bridges, props, buildings, trees
src/world/chunk.js     a loaded tile: meshes + queries (height, road, buildings, water, street names, road links)
src/world/world.js     the moving window of tiles, look-ahead loading, floating origin
src/world/sky.js       sun, weather, fog, rain/snow
src/game/physics.js    arcade handling (grip, slip, drift, jumps, collisions, fuel, damage)
src/game/vehicles.js   real-world vehicle stats and low-poly models
src/game/traffic.js    ambient traffic on the real road network
src/game/activities.js daily jobs and races (seeded by date + tile), landmarks, fuel
src/game/places.js     random placement towns
src/game/profile.js    saved progress (this device only)
src/data/              map tiles, terrain, weather, services, network helper, cache
```

Built on the same open-data foundation as [OpenWorld](https://github.com/mediavanity-dev/OpenWorld).

## Data & attribution

Map data © OpenStreetMap contributors (ODbL), tiles by OpenFreeMap. Elevation: AWS Terrain Tiles
(Mapzen/Tilezen). Weather and waves: Open-Meteo (CC BY 4.0). Place search: Nominatim. Postcards:
Wikipedia / Wikimedia Commons (free licences only).
