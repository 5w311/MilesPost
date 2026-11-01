/* The slice of Rig UI this app actually uses.
   Importing rig.js would register all ninety components and pull 153 modules into the
   service worker's precache. MilesPost is an offline-first app on truck data, so it
   takes only what it renders — each file pulls its own dependencies, and the closure
   of this list is exactly what sw.js caches.

   Adding a component: add its import here, re-run `npm run rig:manifest`, and paste the
   result into ASSETS in sw.js. See rig-ui/VENDORED.md. */

import './src/morph-icon.js';       // <rig-icon>
import './src/navigation/tabs.js';  // <rig-tabs> — ETA / 34 RESET
import './src/forms/input.js';      // <rig-input> — every text, number and datetime field
import './src/forms/switch.js';     // <rig-switch> — Running, Override, day/night
import './src/pickers/select.js';   // <rig-select> — time zones
import './src/pickers/combobox.js'; // <rig-combobox> — destination and origin towns
import './src/pickers/date-picker.js'; // <rig-date-picker time> — Rolling out, Appointment, Shut down
import './src/overlays/dialog.js';  // <rig-dialog> — the help sign
import './src/overlays/drawer.js';  // <rig-drawer> — a stop's details
import './src/overlays/tooltip.js'; // data-tip
import './src/display/badge.js';    // <rig-badge> — chips and exit tabs
import './src/display/alert.js';    // <rig-alert> — warnings, cushion, reserve
import './src/display/separator.js';// <rig-separator> — mileposts
import './src/display/item.js';     // <rig-item> — the stop list
import './src/display/progress.js'; // <rig-progress> — the 34 bars
import './src/display/empty.js';    // <rig-empty>
import './src/display/collapsible.js'; // <rig-collapsible> — the tuning fields fold away
import './src/genui/route-map.js'; // <rig-route-map> — the run drawn from HERE's geometry
import './src/data/table.js';      // <rig-table> — the swap schedule

export { toast } from './src/toast.js';
export { setButtonLoading, withButtonLoading } from './src/forms/button.js';
export { sound } from './src/sound.js';
