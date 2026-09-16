# Installing Lapka step by step

Русская версия: [INSTALL.ru.md](INSTALL.ru.md)

For those who have never run a program from its source. Nothing hard: Lapka is
a folder of files that Node.js runs. There is no installer for Lapka itself,
and it writes nothing into the system.

If you are doing this with an AI assistant, show it this whole page.

## What you need

| What | Why | Required |
|---|---|---|
| Node.js 22 or newer | runs the Lapka server | yes |
| Chrome or Edge | the player; the extended PiP window exists only there | yes (Firefox and Safari show the player without the extended window) |
| ffmpeg | saving episodes to a file | no, only for saving |
| A terminal | to type two commands | yes |

The terminal is already on the system: on macOS the Terminal app, on Windows
the Terminal or PowerShell, on Linux any terminal emulator.

## Step 1. Node.js

Check whether it is there already. In the terminal:

```bash
node -v
```

If the answer looks like `v22.…` or `v24.…`, skip this step. If the command is
not found or the version is below 22, install it.

**macOS.** Go to https://nodejs.org/, press the **LTS** button, open the
downloaded `.pkg` and walk through the installer. Or with Homebrew, if you
have it:

```bash
brew install node
```

**Windows.** Go to https://nodejs.org/, press **LTS**, run the `.msi`, "Next"
everywhere. The checkbox about "automatically install the necessary tools" can
stay off. After the installation close the terminal and open it again.

**Linux.** The `nodejs` package of the distribution is often old. Safer: the
installer from nodejs.org (the "Package manager" section) or nvm:

```bash
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/master/install.sh | bash
```

then, in a new terminal, `nvm install --lts`.

`node -v` again, to be sure.

## Step 2. Download Lapka

Without git: on https://github.com/MythHand/Lapka press the green **Code**
button → **Download ZIP**, unpack the archive where it will live, for example
in Documents. You get a folder `Lapka-main`; you may rename it to `Lapka`.

With git, if you have it:

```bash
git clone https://github.com/MythHand/Lapka.git
```

## Step 3. Open a terminal in the Lapka folder

**macOS.** In Finder, right-click the `Lapka` folder → "New Terminal at Folder"
(if the item is missing, switch it on in System Settings → Keyboard → Keyboard
Shortcuts → Services). Or type `cd ` in the terminal, drag the folder into the
window, and press Enter.

**Windows.** Open the `Lapka` folder in Explorer, right-click an empty spot →
"Open in Terminal". Or type `cmd` in Explorer's address bar and press Enter.

**Linux.** Right-click the folder → "Open in Terminal", or `cd` into it.

Check: `ls` (in Windows `dir`) should list the file `package.json` and the
folders `core` and `web`.

## Step 4. Install the dependencies and start

Once:

```bash
npm install
```

Every time you want to watch:

```bash
npm start
```

The terminal prints a line `Lapka: http://127.0.0.1:8800`. Open that address in
Chrome or Edge. Lapka runs while the terminal is open; to close it, Ctrl+C in
the terminal or simply close the terminal window.

## Step 5. The folder for files

In the player: the gear at the top right → "Lapka folder" → "Choose another
folder". The system's folder dialog opens. Saved episodes and Lapka's own files
go there. If you never choose a folder, the files pile up in `.dev/home` inside
the Lapka folder.

On Linux the system dialog needs the `zenity` program; without it the path can
be typed by hand through the "type a path instead" link in the same menu.

## ffmpeg, only for saving episodes

Watching works without it. The save button needs ffmpeg reachable from the
terminal by the name `ffmpeg`.

**macOS** (with Homebrew):

```bash
brew install ffmpeg
```

**Windows:**

```bash
winget install Gyan.FFmpeg
```

After the installation close the terminal and open it again, then `npm start`
once more.

**Linux:**

```bash
sudo apt install ffmpeg
```

(or the package manager of your distribution). The check everywhere:
`ffmpeg -version`.

## Updating

Download a fresh ZIP and unpack it over the old folder, or run `git pull` in
the `Lapka` folder if you installed with git. Then `npm install` and
`npm start` again. The settings and the chosen folder stay.

## If something is off

**`npm` or `node` not found.** Node.js is not installed, or the terminal was
opened before the installation. Close the terminal, open it again, `node -v`.

**Port 8800 is taken.** Start on another one:

```bash
PORT=8801 npm start
```

In Windows PowerShell: `$env:PORT=8801; npm start`.

**The page does not open.** Make sure the terminal with `npm start` is open
and shows no red errors; the address is exactly `http://127.0.0.1:8800`, not
`https`.

**Saving does not work, playing does.** No ffmpeg, or it is not in PATH. Check
`ffmpeg -version` in a new terminal window.

**A site did not open.** Not every site is built the same way; the list of
tested ones is in the [README](../README.md). Sites with DRM, and sites that
lock their players, Lapka does not break into, on principle.

**No extended PiP window.** It exists only in Chrome and Edge (Document
Picture-in-Picture). In other browsers the ordinary picture-in-picture window
is there.
