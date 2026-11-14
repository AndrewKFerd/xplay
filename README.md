# XPLAY

<img src="assets/logo.png" alt="XPLAY" width="300">


XPLAY is a browser tabletop simulator for the **Xross Stars** TCG, in the spirit of Cardfight!! Area:
a manual playmat with rules helpers, a deck builder and an importable card database.
Play **online** (room codes) or **hot-seat** on one computer, with card text in **English** or Japanese.

## Automatic card updates

Every time XPLAY starts, a loading screen ("Trying to update…") checks the official card list while
showing a rotating line from `data/update-quips.json`. There are 64 lines, mostly riffing on VSPO!
members' official signature cards; edit them freely.

- **The check:** two tiny requests (card count plus newest card, and the banned/limited list). It runs
  at most every 10 minutes, skips on in-session reloads, and has a **Skip** button.
- **When a set changes:** if the signature differs, or after a week, the full list downloads in the
  background (about 9 requests). It's converted exactly like `tools/fetch-cards.mjs`, so card IDs and
  saved decks stay valid, and the screen shows **"N new cards!"**.
- **Where it's saved:** `updates/`, never over the bundled `data/` files. The newer of the two is served
  to the app.
- **New cards:** they show in Japanese until a translation pack arrives (below). Card art downloads on
  demand as usual.
- **Translation packs:** the updater also downloads English translations from the address in
  `data/update-sources.json`. It's only taken when its version is newer and it passes checks: correct
  format, and not much smaller than what's installed. The loading screen then says **"Translations
  updated"**.

### Publishing translations after a new set

1. Add the new names and lines to `data/i18n/glossary.json` and `data/i18n/effects.en.json`.
   `node tools/i18n-check.mjs` lists what's missing.
2. Run `node tools/publish-translations.mjs --gist` with `GITHUB_TOKEN` set to a GitHub token that has
   the **gist** scope. The first run creates a secret (unlisted) Gist and saves its address in
   `data/update-sources.json`.
3. **First time only:** rebuild the installer so copies know where to look. After that, every install
   picks up new translations on its next launch, with no reinstall.

Without `--gist`, the pack is written to `dist/translations/` to upload anywhere that serves raw files.
Put that address in `data/update-sources.json` as `"translations"`.
- **Offline:** the screen says "Playing offline" and you play with the cards you have.

## Share with friends (installer)

Send friends **`dist\XPLAY-<version>.msi`** (about 10 MB). It installs without admin rights to
`%LOCALAPPDATA%\Programs\XPLAY`, adds Start Menu and Desktop shortcuts, and bundles its own Python, so
friends need nothing else. It opens in their Chrome or Helium if they have one, otherwise in Edge, which
every Windows PC has. Uninstall it from Settings → Apps.

- **Rebuild after changes:** double-click `installer\build-msi.bat`, or run
  `pwsh -File installer\build-msi.ps1`. It needs the .NET SDK. The first run downloads WiX 5 and the
  embeddable Python into `build\`.
- **Updates:** bump `"version"` in `package.json`, rebuild, and send the new `.msi`. Installing it
  replaces the old version (even while it's running), and decks and settings are kept.
- **Windows SmartScreen:** the installer isn't code-signed, so Windows may show "Windows protected your
  PC". Friends click **More info → Run anyway**. Avoiding that needs a paid code-signing certificate.

## Online play

**Online → Create room** gives a 6-character code. Your friend picks **Online → Join** and enters it.
You each need a copy of this folder.

| Mode | When to use | How it connects |
|---|---|---|
| **Internet (peer-to-peer)** | Friend anywhere | WebRTC through the public PeerJS signaling server. No port forwarding. Very strict networks may block it. |
| **Local server** | Same PC, same Wi-Fi, or a VPN like Tailscale | Relayed by `tools/serve.py`. The host runs `start-lan.bat`. The friend opens the address it prints and joins in this mode. |

- The host is authoritative: each action sends the full game state with a sequence number. If both
  players act at the same moment, the host's version wins.
- Each player only sees their own hand and tactics, and there's a chat in the sidebar.
- Undo only covers your own most recent actions.
- Only the host can press **Continue** between rounds.
- If the connection drops, the guest rejoins with the same code and the host resends the game.
- This is a trust-based fan table like Area: the full state is shared, so a determined player could
  read the other's hand with developer tools.

## Language and names

The 🌐 menu switches card text between English and 日本語 at any time, including mid-match and in old log entries.

- `data/i18n/glossary.json` is the **single source of truth** for every name and term: talents, card names,
  timing tags (【アタック後】 → **After Attack**), keywords and group tags. Each is translated exactly once.
  Talent names use Given-name Family-name order. Romanizations I'm less sure of are listed under `verify`.
- `data/i18n/effects.en.json` translates each unique effect line. Lines keep the 【tag】 and 「card name」
  tokens, so names always come from the glossary and can't drift. The log stores card IDs rather than
  names for the same reason.
- **Color coding:**
  - Timing tags are colored chips: Attack, After Attack, Attack Boost, On Play, This Round, On Awaken, Overkill.
  - Card and talent names use their card's color.
  - Numbers are highlighted by meaning: damage, healing, card draw, PP, ATK/HP.
- After a new set, run `node tools/i18n-check.mjs`. It lists everything still untranslated in
  `data/i18n/todo.json`.

## Animations and image cache

- Cards glide between zones, and drawn cards fly out of the deck one at a time.
- Attackers lunge at their targets; hits shake the card and float the damage number while the counter counts up.
- Downed leaders tip over, awakening flips the card in a gold burst, and turn and round banners sweep across.
- **Sound effects** are synthesized in the browser, with no audio files. There are sounds for drawing,
  playing, PP, attacks and hits, down, awaken, heal, shuffles, your turn, round wins and chat messages.
  They play for your opponent's actions too in online games. Use 🔊 and the volume slider in the
  sidebar; the setting is remembered.
- **⤨ Shuffle hand** in your player bar randomizes your hand order.
- Pick **normal / slow / fast / off** in the sidebar. Off is the default if your system asks for reduced motion.
- Card art is downloaded from the official server **once**. After that it's served from `cache/img/`
  on disk, and your browser keeps it as immutable. Delete that folder to clear the cache.

## Run it

Double-click **`XPLAY.lnk`** or `start.bat` (needs Python). It opens as its **own app window**:
no tabs, no address bar, its own taskbar icon. This uses your Chromium-based browser's `--app` mode
(Helium, Chrome, Edge or Brave), so there's no Electron. The local server runs hidden in the background
and stops by itself about 5 minutes after the last window closes.

- Recreate the shortcut with `pythonw tools/launch.py --make-shortcut`. You can pin it to the taskbar or
  copy it to the desktop.
- To force a specific browser, set `XC_BROWSER` to its `.exe` path.
- The browser's "Install app" option also works (there's a web app manifest).
- Without the launcher, run `python tools/serve.py` and open <http://localhost:8137>.

The game table is a fixed 1600×900 stage that scales evenly to fit the window, so the layout never
reflows when you resize or when hands and play areas fill up.

All data (cards, images, decks, the current game) is saved in your browser for `localhost:8137`.

## What's in it

- **Playmat**: 4 leaders per side (damage counters, down, awaken/flip), deck, face-down trash,
  tactics deck plus tactics area, PP cards, PP Ticket, play area, hand, game log, unlimited undo (Ctrl+Z).
- **Rules helpers** (from the official Playing Manual):
  - The start of each turn refreshes PP and draws 1 card.
  - Playing a card pays its cost in PP. Memoria boosts apply to the next attack.
  - An attack asks for an attacker and a target. Damage is ATK + card damage + boost, and you can edit the total.
  - A leader is downed automatically when its damage reaches its HP. The attacking leader then awakens.
  - At end of turn, the play area goes to the trash, you draw 1 card per unused PP, then discard down to 7.
  - Deck-out costs a random tactics card, then the trash is reshuffled into the deck.
  - Rounds follow BO3 or Quick Match rules: PP goes 3→4→5, the loser of a round goes first, and awakening carries over.
- **Manual control**: drag any card anywhere (Shift-drop on a deck puts it at the bottom). Right-click or click
  for menus. Nothing is locked, so card effects are resolved by hand like in Area.
- **Hot-seat privacy**: a cover screen hides the hand when play passes. Tick *Open hands* to play both sides.
- **Deck builder**: 4 leaders, 50 main deck cards and 5 tactics, with legality checks:
  - Leader names must all differ.
  - Main deck cards must match a leader's color, or be Neutral.
  - Up to 4 copies by name, or the card's limit.
  - Up to 8 ACE cards.
  - Tactics names must all differ.
  
  You can export and import decks as `.json` or `.txt`.

## Card data

`data/xross-cards.json` holds the **official card list** (757 cards; PP tokens are skipped), pulled from
the public API behind xross-stars.com/card. The app loads it automatically. Card art is linked from the
official image server and cached by your browser as you browse.

Refresh it when a new set comes out, then use **Cards → Reset… → Delete all cards & load the official card list**:

```
node tools/fetch-cards.mjs
```

For offline play, `node tools/fetch-cards.mjs --images` also downloads all art into `images/`. That's about
700 MB.

Build rules from the API are enforced in the deck builder. "リーダー：X" requires leader X in the deck, and
"赤のリーダー3体以上" requires 3+ red leaders. Alternate arts are hidden by default and count toward the same
name's 4-copy limit. Limited and banned cards aren't in the API, so set `limit` by hand in the card editor
if you need it.

The official banned / limited list (`/v1/cards/restrictions`) is applied too. Currently that's
エナジーチャージャー, which is banned in all 4 prints.

## Decks

- **Deck code import:** in the deck builder, **Deck code** accepts a code or a `xross-stars.com/deck/…` link from
  the official deck builder. This needs the app started with `start.bat` / `tools/serve.py`, because the local
  server relays the lookup; browsers can't call the official API directly from localhost.
- **Bundled decks:** 9 tournament and shop recipes publicly shared by Yuyu-tei (遊々亭) writer じーやま are
  loaded on first start. They're listed in `data/deck-codes.json`, each with its source article. Add codes there
  and run `node tools/fetch-decks.mjs` to rebuild `data/official-decks.json`.
- **Starter decks:** the official site only shows starter deck contents as an image, so they aren't bundled. If
  you have a starter deck's code, use **Deck code**.

`data/sample-cards.json` is a small placeholder set of made-up cards, also available from the Reset menu.

### Importing your own cards

Open **Cards → Import cards** and pick a `.json` array or `.csv` file. The official site's field names
(`card_number`, `card_type`, `image_url`) and Japanese labels (リーダー / 赤 …) are understood, as are these fields:

| field | meaning |
|---|---|
| `id` | card number, e.g. `XS01-001` (also used to match image files) |
| `name`, `type` | `type` is `leader`, `attack`, `memoria` or `tactics` |
| `color` | e.g. `Red`, or `Red/Blue`. `Neutral` fits any deck |
| `cost` | PP cost |
| `damage` | attack card damage |
| `boost` | memoria attack boost |
| `atk`, `hp`, `atkAwake`, `hpAwake` | leader stats, unawakened and awakened |
| `text`, `textAwake` | effect text |
| `tacticsKind` | `consumable` or `equipment` |
| `ace` | `true` / `false` |
| `limit` | max copies: 4 is normal, 2 is limited, 0 is banned |
| `buildRule` | free text, shown as a warning |
| `set`, `rarity` | optional |
| `image`, `imageBack` | optional image URL or path |

**Cards → CSV template** downloads a starter sheet.

**Images:** use **Cards → Import image folder**. Name each file by card id: `XS01-001.jpg` is the front.
`XS01-001_back.jpg` is the awakened side of a leader. Cards without images get a generated face.

## Rule notes / assumptions

- Leaders, ATK/HP values and card types come from the official Playing Manual summary. Specific card
  effects are not automated.
- At deck-out, tactics cards already in the trash stay there and are not shuffled into the main deck.
- The game log notes tactics-timing restrictions (one per turn, none on the first player's first turn)
  but doesn't enforce them.

## Publishing an update (auto-update)

Installed copies (1.5.0 and newer) check `https://github.com/AndrewKFerd/xplay` on every launch and
update themselves. The repo must be **public**.

1. Make a fine-grained GitHub token with **Contents: read and write** on that repo only.
2. In a terminal in this folder:

   ```
   set GITHUB_TOKEN=<your token>          (cmd)   or   $env:GITHUB_TOKEN="<your token>"   (PowerShell)
   npm run release -- patch --notes "What changed, in a sentence"
   ```

   `patch` bumps 1.5.0 -> 1.5.1 (`minor` -> 1.6.0, or give an exact version). `--dry-run` builds
   the files in `dist/release/` without uploading.
3. Add `--installer` only when the bundled Python or the installer changed: it builds a new .msi and
   installed copies run it silently. Every release attaches the newest .msi for new players.

If an update fails to start, the app marks it bad and runs the installed version instead.
