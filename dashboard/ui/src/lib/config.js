// Numbers that are not computed live in the browser. Set at merge time from the final model's evaluation (see README: skill table).
export const SKILL_DAY1_PCT = 36;   // day-1 lat-weighted RMSE skill vs 'tomorrow = today', 2019-21, 2-seed ensemble trained on 2005-18 only (DECISIONS.md)
export const SKILL_DAY10_TEXT = '(27 % on day 8)'; // optional day-10 sentence, e.g. "At day 10: 12 % lower error." Hidden when empty.
export const SPEED_KM_PER_DAY = 900; // 8 grid cells per day, by construction (8 stacked 3x3 convolutions)
export const LOCAL_KM = 300;         // locality is measured inside the box plus 3 grid cells (~300 km) around it (js/shock.js ripple)
export const HONESTY_LINE = 'Model what-if, not a forecast. Big, far-away changes are less certain than nearby ones.';
