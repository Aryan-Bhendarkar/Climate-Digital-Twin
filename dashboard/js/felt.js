// How a day would feel to someone standing there, in two sentences. Pure rules, no DOM.
// The inputs are the forecast's daily means over one 1-degree square: temperature (°C), rain (mm/day), wind (km/h),
// water vapour in the air column (kg/m², our stand-in for how damp the air is) and sea-level pressure (hPa).
// This is an interpretation of the numbers, not something the model predicts.

const one = (x) => (Math.round(x * 10) / 10).toString();

function air(t, vapour) {
  const damp = vapour >= 45, dry = vapour < 18;
  if (t >= 33) {
    if (damp) return 'Oppressive, sticky heat: sweat will not dry and even the shade feels close';
    if (dry) return 'Fierce, dry heat: the air parches your throat and midday outdoors is punishing';
    return 'Very hot: you will want shade, water and a slow afternoon';
  }
  if (t >= 28) {
    if (damp) return 'Hot and muggy: clothes cling, and a fan only moves warm air around';
    if (dry) return 'Hot but dry: the sun is sharp, yet shade brings real relief';
    return 'Hot: bearable indoors under a fan, tiring out in the sun';
  }
  if (t >= 23) return damp ? 'Warm and damp: the air feels soft and sticky, most of all at midday' : 'Pleasantly warm: easy weather to be outdoors in';
  if (t >= 17) return damp ? 'Mild but damp: the air feels cool and clammy on the skin' : 'Mild and comfortable, with a cool edge to the morning';
  if (t >= 10) return 'Cool: you will reach for a light jacket in the morning and evening';
  if (t >= 2) return 'Cold: warm layers are needed and the mornings bite';
  return 'Freezing: exposed skin hurts quickly, so wrap up fully';
}

function sky(rain, wind, pressure) {
  const breeze = wind < 6 ? 'barely a breeze' : wind < 15 ? 'a light breeze' : wind < 28 ? 'a brisk wind' : 'strong, gusty wind';
  const wet = rain >= 0.5;
  const above = pressure < 1000 ? 'heavy, unsettled low-pressure skies' : pressure > 1015 ? 'calm, settled high-pressure skies' : wet ? 'grey skies' : 'a fairly settled sky';
  if (!wet) return `No real rain and ${breeze} under ${above}`;
  const [what, advice] = rain < 2.5 ? ['A passing drizzle', 'little to plan around']
    : rain < 10 ? ['A few showers', 'an umbrella is worth carrying']
      : rain < 30 ? ['Steady, soaking rain', 'expect wet roads and slow traffic']
        : rain < 65 ? ['Heavy rain', 'low-lying streets may flood']
          : ['Torrential rain', 'flooding is likely, so stay in if you can'];
  return `${what} with ${breeze} under ${above}; ${advice}`;
}

/** How today differs from the same day without the change, in everyday words, or ''. */
function against(now, base) {
  if (!base) return '';
  const dt = now.temp - base.temp, dr = now.rain - base.rain, dw = now.wind - base.wind, parts = [];
  if (Math.abs(dt) >= 0.5) parts.push(`${one(Math.abs(dt))} °C ${dt > 0 ? 'warmer' : 'cooler'}`);
  if (Math.abs(dr) >= 1) parts.push(dr > 0 ? 'wetter' : 'drier');
  if (Math.abs(dw) >= 3) parts.push(dw > 0 ? 'windier' : 'calmer');
  if (!parts.length) return '';
  const list = parts.length > 1 ? `${parts.slice(0, -1).join(', ')} and ${parts.at(-1)}` : parts[0];
  return `, ${list} than without your change`;
}

/** now / base: {temp, rain, wind, vapour, pressure}; base is the unchanged forecast, only when showing a changed one. */
export function feels(now, base = null) {
  return [`${air(now.temp, now.vapour)}${against(now, base)}.`, `${sky(now.rain, now.wind, now.pressure)}.`];
}
