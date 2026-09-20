import type { VehicleClass } from './names';

const BODY = 'fill="{primary}" stroke="{outline}" stroke-width="1.5" stroke-linejoin="round"';
const PART = 'fill="{primary}" stroke="{outline}" stroke-width="1"';
const DARK_LINE = 'fill="none" stroke="{dark}" stroke-width="1.3" stroke-linecap="round"';

/** Windscreen of a cab-over truck whose body starts at y=`y` (12 wide body, x=10..22). */
const truckGlass = (y: number): string =>
  `<rect x="11.5" y="${y}" width="9" height="3" rx="1" fill="{light}"/>`;

/** Inner SVG markup for a 32×32 viewBox, vehicle seen from ABOVE with the nose pointing UP (north). Tokens: {primary} = family colour, {dark} = darker shade, {light} = highlight/glass, {outline} = outline colour. */
export const TOPDOWN: Record<VehicleClass, string> = {
  // Pumper: cab + hose bed flanked by two equipment lockers.
  engine:
    `<rect x="10" y="4" width="12" height="24" rx="2.5" ${BODY}/>${truckGlass(5.5)}` +
    '<rect x="11.5" y="10" width="9" height="1.4" rx="0.7" fill="{dark}"/>' +
    '<rect x="13.5" y="13.5" width="5" height="12.5" rx="1" fill="{dark}"/>' +
    `<path d="M11.8 14v11.5M20.2 14v11.5" ${DARK_LINE}/>`,

  // Water tender: long elliptical tank behind the cab.
  tanker:
    `<rect x="10" y="3.5" width="12" height="25.5" rx="2.5" ${BODY}/>${truckGlass(5)}` +
    '<ellipse cx="16" cy="19.5" rx="4.6" ry="8.3" fill="{dark}"/>' +
    '<circle cx="16" cy="19.5" r="1.5" fill="{primary}"/>',

  // Aerial ladder: two rails with rungs running the whole length, overhanging the cab.
  ladder:
    `<rect x="10" y="4" width="12" height="25" rx="2.5" ${BODY}/>${truckGlass(6)}` +
    '<circle cx="16" cy="24.5" r="3.2" fill="{dark}"/>' +
    '<path d="M14 2.5V25M18 2.5V25M14 5h4M14 8h4M14 11h4M14 14h4M14 17h4M14 20h4" fill="none" stroke="{dark}" stroke-width="1.4" stroke-linecap="round"/>',

  // Mobile crane: turret at the rear, thick boom pointing forward past the nose.
  crane:
    `<rect x="10" y="5.5" width="12" height="23.5" rx="2.5" ${BODY}/>${truckGlass(7.5)}` +
    '<rect x="14.2" y="2" width="3.6" height="21" rx="1" fill="{dark}" stroke="{outline}" stroke-width="0.75"/>' +
    '<circle cx="16" cy="22.5" r="3.8" fill="{dark}"/><circle cx="16" cy="22.5" r="1.3" fill="{primary}"/>',

  // Pickup: hood, glass, short cab roof, open dark bed.
  pickup:
    `<rect x="10.5" y="5" width="11" height="22" rx="2.5" ${BODY}/>` +
    '<path d="M12 12.5l.8-2.5h6.4l.8 2.5z" fill="{light}"/>' +
    '<rect x="12" y="17.5" width="8" height="8" rx="1" fill="{dark}"/>' +
    `<path d="M12.5 8h7" ${DARK_LINE}/>`,

  // Van: one-box body, light bar behind the windscreen, roof ribs.
  van:
    `<rect x="10.5" y="4.5" width="11" height="23" rx="3" ${BODY}/>` +
    '<path d="M12 10l.8-3h6.4l.8 3z" fill="{light}"/>' +
    '<rect x="11.8" y="11.5" width="8.4" height="2.2" rx="1.1" fill="{dark}"/>' +
    `<path d="M13 18h6M13 21.5h6M13 25h6" ${DARK_LINE}/>`,

  // Patrol car: rounded body, front + rear glass, light bar mid-roof.
  car:
    `<rect x="11" y="6" width="10" height="20" rx="4" ${BODY}/>` +
    '<path d="M12.5 13l.9-3h5.2l.9 3z" fill="{light}"/>' +
    '<path d="M12.8 21h6.4l-.7 2.2h-5z" fill="{light}"/>' +
    '<rect x="12" y="15.2" width="8" height="2.4" rx="1.2" fill="{dark}"/>',

  // Motorcycle: single track (two tyres in line), slim tank/seat, handlebar, rider helmet.
  motorcycle:
    '<rect x="14.6" y="3.5" width="2.8" height="7" rx="1.4" fill="{dark}" stroke="{outline}" stroke-width="0.75"/>' +
    '<rect x="14.6" y="21.5" width="2.8" height="7" rx="1.4" fill="{dark}" stroke="{outline}" stroke-width="0.75"/>' +
    `<path d="M16 8c2 0 3.2 2 3.2 5v6c0 3-1.2 5-3.2 5s-3.2-2-3.2-5v-6c0-3 1.2-5 3.2-5z" ${BODY}/>` +
    '<path d="M14 11.5c0-1.5.8-2.3 2-2.3s2 .8 2 2.3z" fill="{light}"/>' +
    `<rect x="9.5" y="11.5" width="13" height="2" rx="1" ${PART}/>` +
    '<circle cx="16" cy="17.5" r="2.6" fill="{dark}"/>',

  // Ambulance: box body, light bars front and rear, pulse line on the roof (no cross).
  ambulance:
    `<rect x="10" y="4" width="12" height="24" rx="2.5" ${BODY}/>${truckGlass(5.5)}` +
    '<rect x="11.5" y="10" width="9" height="1.8" rx="0.9" fill="{dark}"/>' +
    '<rect x="11.5" y="25" width="9" height="1.5" rx="0.75" fill="{dark}"/>' +
    '<polyline points="11.8,18.5 13.8,18.5 15,15.5 17,21.5 18.2,18.5 20.2,18.5" fill="none" stroke="{dark}" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>',

  // Box truck: separate cab and cargo box with roof ribs.
  truck:
    `<rect x="10.5" y="3.5" width="11" height="7.5" rx="2" ${BODY}/>${truckGlass(5)}` +
    `<rect x="10" y="11.5" width="12" height="17.5" rx="1" ${BODY}/>` +
    `<path d="M10.8 15.5h10.4M10.8 19.5h10.4M10.8 23.5h10.4" ${DARK_LINE}/>`,

  // Command unit: box body with a satellite dish and a whip-antenna base.
  command:
    `<rect x="10" y="4" width="12" height="24" rx="2.5" ${BODY}/>${truckGlass(5.5)}` +
    '<circle cx="16" cy="20" r="4.2" fill="{dark}"/><circle cx="16" cy="20" r="1.4" fill="{light}"/>' +
    '<rect x="12" y="11" width="3" height="3" rx="0.5" fill="{dark}"/><circle cx="19" cy="12.5" r="1.2" fill="{dark}"/>',

  // Rescue boat: pointed bow, inner deck, console with glass, outboard at the stern.
  boat:
    '<rect x="14.2" y="27" width="3.6" height="3" rx="0.8" fill="{dark}" stroke="{outline}" stroke-width="0.75"/>' +
    `<path d="M16 2c3.5 3.5 5.5 8 5.5 13v11a2 2 0 0 1-2 2h-7a2 2 0 0 1-2-2V15c0-5 2-9.5 5.5-13z" ${BODY}/>` +
    '<path d="M16 6.5c2 2.5 3.2 5.5 3.2 9v9.5h-6.4V15.5c0-3.5 1.2-6.5 3.2-9z" fill="{dark}"/>' +
    '<rect x="13.5" y="16" width="5" height="5.5" rx="1" fill="{primary}"/>' +
    '<path d="M13.5 16l.7-2.2h3.6l.7 2.2z" fill="{light}"/>',

  // Helicopter: translucent rotor disc, teardrop fuselage, tail boom + stabiliser, two blades, hub.
  helicopter:
    '<circle cx="16" cy="14" r="13" fill="{light}" fill-opacity="0.25"/>' +
    `<rect x="12" y="25.5" width="8" height="2.2" rx="1.1" ${PART}/>` +
    `<path d="M16 4.5c3 0 4.8 2.5 4.8 6v4c0 2.5-1.5 4.2-3.3 5.2L17 29.5h-2l-.5-9.8c-1.8-1-3.3-2.7-3.3-5.2v-4c0-3.5 1.8-6 4.8-6z" ${BODY}/>` +
    '<path d="M12.7 10.5c0-2.7 1.3-4.2 3.3-4.2s3.3 1.5 3.3 4.2z" fill="{light}"/>' +
    '<path d="M6.8 4.8 25.2 23.2M25.2 4.8 6.8 23.2" fill="none" stroke="{dark}" stroke-width="1.6" stroke-linecap="round"/>' +
    '<circle cx="16" cy="14" r="2" fill="{dark}" stroke="{outline}" stroke-width="0.75"/>',

  // Fire-fighting plane: straight high wing with two engine nacelles, tailplane, slim fuselage.
  plane:
    `<path d="M2 13.5h28v4l-12 1.5h-4l-12-1.5z" ${BODY}/>` +
    `<path d="M10 25.5h12v2.5l-5 1h-2l-5-1z" ${BODY}/>` +
    `<path d="M16 1.5c1.8 0 2.6 2 2.6 4.5v17l-1.6 7.5h-2L13.4 23V6c0-2.5.8-4.5 2.6-4.5z" ${BODY}/>` +
    '<path d="M14.3 6c0-1.7.7-2.6 1.7-2.6s1.7.9 1.7 2.6z" fill="{light}"/>' +
    '<rect x="7.5" y="11.5" width="2.6" height="6" rx="1.2" fill="{dark}"/><rect x="21.9" y="11.5" width="2.6" height="6" rx="1.2" fill="{dark}"/>',

  // Foot team: three people from above (shoulders + head) in a wedge.
  team:
    `<ellipse cx="16" cy="9.5" rx="5" ry="3.2" ${BODY}/><circle cx="16" cy="9.5" r="2.4" fill="{dark}"/>` +
    `<ellipse cx="9.5" cy="21.5" rx="5" ry="3.2" ${BODY}/><circle cx="9.5" cy="21.5" r="2.4" fill="{dark}"/>` +
    `<ellipse cx="22.5" cy="21.5" rx="5" ry="3.2" ${BODY}/><circle cx="22.5" cy="21.5" r="2.4" fill="{dark}"/>`,

  // Snowmobile: two front skis on struts, tapered hood, handlebar, seat, track at the rear.
  snowmobile:
    '<rect x="13.2" y="20.5" width="5.6" height="8.5" rx="1.2" fill="{dark}" stroke="{outline}" stroke-width="0.75"/>' +
    '<path d="M12.5 9.5h-3M19.5 9.5h3" fill="none" stroke="{outline}" stroke-width="1.5"/>' +
    '<rect x="8" y="3" width="2.4" height="11" rx="1.2" fill="{dark}" stroke="{outline}" stroke-width="0.75"/>' +
    '<rect x="21.6" y="3" width="2.4" height="11" rx="1.2" fill="{dark}" stroke="{outline}" stroke-width="0.75"/>' +
    `<path d="M16 5c2.5 0 3.8 2 3.8 5v13.5a2 2 0 0 1-2 2h-3.6a2 2 0 0 1-2-2V10c0-3 1.3-5 3.8-5z" ${BODY}/>` +
    '<path d="M13.3 12c0-2.2 1-3.4 2.7-3.4s2.7 1.2 2.7 3.4z" fill="{light}"/>' +
    `<rect x="10.5" y="13" width="11" height="1.8" rx="0.9" ${PART}/>` +
    '<rect x="14" y="16" width="4" height="8" rx="2" fill="{dark}"/>',

  // Tow truck: cab, dark flatbed with two ramp tracks, tow bar sticking out at the rear.
  tow:
    `<path d="M16 26v4M13.5 30h5" fill="none" stroke="{outline}" stroke-width="1.5" stroke-linecap="round"/>` +
    `<rect x="10" y="3" width="12" height="24.5" rx="2" ${BODY}/>${truckGlass(4.5)}` +
    '<rect x="11.5" y="11" width="9" height="15" rx="0.8" fill="{dark}"/>' +
    '<rect x="12.5" y="12" width="2" height="13" fill="{primary}"/><rect x="17.5" y="12" width="2" height="13" fill="{primary}"/>' +
    '<rect x="11.5" y="9" width="9" height="1.3" rx="0.65" fill="{dark}"/>',

  // Utility / service truck: cab + box body with a diagonal hazard-stripe band across the roof.
  utility:
    `<rect x="10.5" y="4" width="11" height="7.5" rx="2" ${BODY}/>${truckGlass(5.5)}` +
    `<rect x="10" y="12" width="12" height="16" rx="1" ${BODY}/>` +
    '<path d="M10.8 21.5l3.5-3.5h2.8l-6.3 6.3zM13.6 24.5 20.1 18h1.1v1.7l-4.8 4.8zM19.2 24.5l2-2v2z" fill="{dark}"/>' +
    '<rect x="13" y="13.5" width="6" height="2.5" rx="0.5" fill="{dark}"/>',
  // Foam tender: tank with foam bubbles and a roof monitor (cannon) behind the cab.
  foam:
    `<rect x="10" y="3.5" width="12" height="25.5" rx="2.5" ${BODY}/>${truckGlass(5)}` +
    '<ellipse cx="16" cy="21" rx="4.6" ry="7" fill="{dark}"/>' +
    '<circle cx="14.8" cy="19" r="1.7" fill="{light}"/><circle cx="17.6" cy="22" r="1.2" fill="{light}"/><circle cx="15.2" cy="24.6" r="0.9" fill="{light}"/>' +
    '<path d="M16 12V8.2" fill="none" stroke="{dark}" stroke-width="1.8" stroke-linecap="round"/><circle cx="16" cy="12" r="1.7" fill="{dark}"/>',

  // Hazmat / NBCR unit: box truck with the hazard diamond on the roof.
  hazmat:
    `<rect x="10.5" y="3.5" width="11" height="7.5" rx="2" ${BODY}/>${truckGlass(5)}` +
    `<rect x="10" y="11.5" width="12" height="17.5" rx="1" ${BODY}/>` +
    '<path d="M16 13.5l4.6 6.7-4.6 6.7-4.6-6.7z" fill="{light}"/><path d="M16 16.8l2.3 3.4-2.3 3.4-2.3-3.4z" fill="{dark}"/>',

  // Bus / maxi-emergency vehicle: long one-box body, two roof units, side glazing strips.
  bus:
    `<rect x="10" y="2.5" width="12" height="27" rx="2.5" ${BODY}/>${truckGlass(4)}` +
    '<rect x="13" y="9.5" width="6" height="5" rx="1" fill="{dark}"/><rect x="13" y="18.5" width="6" height="5" rx="1" fill="{dark}"/>' +
    '<path d="M11.4 9v17.5M20.6 9v17.5" fill="none" stroke="{light}" stroke-width="1.1" stroke-linecap="round"/>' +
    '<rect x="11.5" y="26.5" width="9" height="1.4" rx="0.7" fill="{dark}"/>',

  // Advanced medical post: truck carrying the field tent (canvas roof with ridge and folds).
  tent:
    `<rect x="10.5" y="3.5" width="11" height="7.5" rx="2" ${BODY}/>${truckGlass(5)}` +
    `<rect x="9.5" y="11.5" width="13" height="17.5" rx="1" ${BODY}/>` +
    '<rect x="10.8" y="12.8" width="10.4" height="14.9" fill="{light}"/>' +
    '<path d="M10.8 12.8 16 16.5l5.2-3.7M10.8 27.7 16 24l5.2 3.7M16 16.5V24" fill="none" stroke="{dark}" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>',

  // Off-road wagon: boxy body, front + rear glass, roof rails and light bar.
  suv:
    `<rect x="10.5" y="4.5" width="11" height="23" rx="3" ${BODY}/>` +
    '<path d="M12 12.5l.8-3h6.4l.8 3z" fill="{light}"/>' +
    '<path d="M12.5 23.5h7l-.6 2.2h-5.8z" fill="{light}"/>' +
    '<rect x="12" y="14" width="8" height="2.2" rx="1.1" fill="{dark}"/>' +
    `<path d="M12.6 17.5v5M19.4 17.5v5" ${DARK_LINE}/>`,

  // Armoured tactical vehicle: angular hull, slit windscreen, roof hatch/turret.
  armored:
    `<path d="M12.5 3.5h7l2.5 4v17.5l-2 3.5h-8l-2-3.5V7.5z" ${BODY}/>` +
    '<rect x="12.5" y="8" width="7" height="1.8" rx="0.5" fill="{light}"/>' +
    '<circle cx="16" cy="17.5" r="3.4" fill="{dark}"/><circle cx="16" cy="17.5" r="1.3" fill="{primary}"/>' +
    `<path d="M12.5 24.5h7" ${DARK_LINE}/>`,

  // Snow plough / gritter: wide angled blade in front of the cab, hopper at the rear.
  plough:
    '<path d="M13 6.5V9M19 5.5V9" fill="none" stroke="{outline}" stroke-width="1.5" stroke-linecap="round"/>' +
    '<path d="M6 5.5 25 2.5l1 2.5L7 8z" fill="{light}" stroke="{outline}" stroke-width="1" stroke-linejoin="round"/>' +
    `<rect x="10.5" y="8" width="11" height="7" rx="2" ${BODY}/>${truckGlass(9.5)}` +
    `<rect x="10" y="15.5" width="12" height="13.5" rx="1" ${BODY}/>` +
    '<rect x="11.5" y="17" width="9" height="10.5" rx="0.8" fill="{dark}"/>' +
    '<path d="M13 19.5h6M13 22.5h6M13 25.5h6" fill="none" stroke="{primary}" stroke-width="1.1" stroke-linecap="round"/>',

  // Quad / ATV: four wide tyres, slim body, handlebar and seat.
  quad:
    '<rect x="8" y="4.5" width="4.2" height="7.5" rx="1.6" fill="{dark}" stroke="{outline}" stroke-width="0.75"/>' +
    '<rect x="19.8" y="4.5" width="4.2" height="7.5" rx="1.6" fill="{dark}" stroke="{outline}" stroke-width="0.75"/>' +
    '<rect x="8" y="20" width="4.2" height="7.5" rx="1.6" fill="{dark}" stroke="{outline}" stroke-width="0.75"/>' +
    '<rect x="19.8" y="20" width="4.2" height="7.5" rx="1.6" fill="{dark}" stroke="{outline}" stroke-width="0.75"/>' +
    `<path d="M16 4.5c2.2 0 3.4 1.6 3.4 4v14.5c0 2.4-1.3 4-3.4 4s-3.4-1.6-3.4-4V8.5c0-2.4 1.2-4 3.4-4z" ${BODY}/>` +
    `<rect x="10.5" y="11.5" width="11" height="1.8" rx="0.9" ${PART}/>` +
    '<rect x="14" y="15" width="4" height="8.5" rx="2" fill="{dark}"/>',
};
