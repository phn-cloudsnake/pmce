# Walkthrough for non-technical users

This is a step-by-step guide to build the **PMCE desktop app** on a Mac, written for people who have never used a code editor or the command line. You don't need to understand the code. Just follow each step in order, and copy-paste the commands exactly as shown.

At the end you'll have a real Mac app (a `.dmg` file, the same kind of installer you get when you download other Mac software) that you can open and use.

Expect this to take about 20–30 minutes the first time, mostly waiting for downloads.

## Easiest option: download the ready-made app (no building)

If you don't want to build anything yourself, you can download a finished installer from the project's Releases page:

**https://github.com/phn-cloudsnake/pmce/releases/latest**

Under **Assets**, download the file for your system:

- **Mac (Apple Silicon — M1/M2/M3/M4):** the file ending in `-arm64.dmg`
- **Windows:** the file ending in `.exe`
- **Linux:** the file ending in `.AppImage`

Then open it like any other installer. On a Mac, double-click the `.dmg` and drag the **PMCE** icon into your **Applications** folder.

### If macOS says the app is "damaged" or "cannot be opened"

This is expected and does **not** mean the file is broken. Because this is a free community app that isn't signed with a paid Apple certificate, macOS blocks it on first open and shows a scary message like *"PMCE is damaged and can't be opened."*

To allow it, first make sure you've dragged **PMCE** into your **Applications** folder, then open **Terminal** (see Step 1 below for how) and paste this line exactly, then press `Return`:

```bash
xattr -dr com.apple.quarantine /Applications/PMCE.app
```

Nothing visible happens — that's fine. Now open PMCE from your Applications folder or Launchpad and it will start normally. You only need to do this once per download.

> Why this happens: macOS adds a "downloaded from the internet" flag to the app, and refuses to open unsigned apps that have it. The command above simply removes that flag. It's safe.

If you'd rather build the app yourself instead, keep reading.

## What you'll be doing

1. Open the Terminal app (a place to type commands).
2. Install two free tools the project needs (Node.js and pnpm).
3. Download the project code.
4. Run one command that builds the app.
5. Open the finished app.

## Before you start

- You need a Mac (Apple Silicon — M1/M2/M3/M4 — or Intel).
- You need an internet connection.
- You'll need your Mac password at a couple of points (the one you use to log in). This is normal.

## Step 1 — Open Terminal

Terminal is an app that comes built into every Mac. It lets you type commands.

1. Press `Command (⌘) + Space` to open Spotlight search.
2. Type `Terminal`.
3. Press `Return`.

A window with a blinking cursor opens. This is where you'll paste the commands below. To run a command, click into the Terminal window, paste it, and press `Return`.

> Tip: To paste, use `Command (⌘) + V`. If Terminal asks for your password while typing a command, type it and press `Return` — the letters won't show on screen, which is normal.

## Step 2 — Install Homebrew (a tool installer)

Homebrew is a free, widely used tool that installs other tools for you. Paste this line into Terminal and press `Return`:

```bash
/bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"
```

- It may ask for your Mac password. Type it and press `Return`.
- It may ask you to press `Return` to continue. Do so.
- When it finishes, it might print two lines starting with `eval` and ask you to run them. If it does, copy those exact lines, paste them, and press `Return`. (If you don't see that message, skip ahead.)

To confirm it worked, paste this and press `Return`:

```bash
brew --version
```

If you see a version number (like `Homebrew 4.x.x`), you're good.

## Step 3 — Install Node.js and pnpm

These are the two tools that actually build the app. Paste this line and press `Return`:

```bash
brew install node pnpm
```

This downloads and sets them up. It can take a few minutes. When it's done, confirm both are installed:

```bash
node --version
pnpm --version
```

Each should print a version number. If `node` shows `v18` or higher, that's what we need.

## Step 4 — Download the project

Now get a copy of the code onto your Mac. Paste these two lines one at a time (press `Return` after each):

```bash
cd ~/Downloads
git clone https://github.com/phn-cloudsnake/pmce.git
```

- The first line moves into your Downloads folder.
- The second downloads the project into a new folder called `pmce`.

> If your Mac asks to install the "command line developer tools" when you run `git`, click **Install** and wait for it to finish, then run the `git clone` line again.

Now move into the project folder:

```bash
cd pmce
```

## Step 5 — Build the app

This is the main step. Paste these two lines one at a time (press `Return` after each, and wait for the first to fully finish before running the second):

```bash
pnpm install
```

```bash
pnpm run build:gui
```

- `pnpm install` downloads the building blocks the app needs. This one takes the longest the first time (several minutes). Lots of text will scroll by — that's normal.
- `pnpm run build:gui` assembles everything into a finished Mac app. This also takes a few minutes.

You're done building when Terminal stops scrolling and you get your normal cursor back without a big red error message.

## Step 6 — Open your new app

The finished installer is a `.dmg` file. Open the folder that contains it with this command:

```bash
open pmce-app/dist/electron/Packaged
```

A Finder window opens. Inside you'll see a file named something like:

```
PMCE-0.1.0-arm64.dmg
```

Double-click it, then drag the **PMCE** icon into your **Applications** folder, just like installing any other Mac app. You can now launch PMCE from your Applications folder or Launchpad.

> The first time you open it, macOS may warn that it's from an unidentified developer (because this is a community build, not from the App Store). If that happens: open **System Settings → Privacy & Security**, scroll to the bottom, and click **Open Anyway**.

> **First-launch warnings are normal.** Because this is a community build (not signed with a paid Apple certificate), macOS may block the first launch. What you see depends on your macOS version:
>
> - If it says the app is from an **unidentified developer**: open **System Settings → Privacy & Security**, scroll to the bottom, and click **Open Anyway**.
> - If it says the app is **"damaged and can't be opened"**: the file is fine — macOS is just blocking an unsigned app. Make sure PMCE is in your **Applications** folder, then run this in Terminal once:
>
>   ```bash
>   xattr -dr com.apple.quarantine /Applications/PMCE.app
>   ```
>
>   Then open PMCE normally. This removes the "downloaded from the internet" flag and is safe.

If you already did all of this once and just want a fresh build later, you only need to reopen Terminal and run:

```bash
cd ~/Downloads/pmce
git pull
pnpm install
pnpm run build:gui
```

`git pull` grabs the latest code; the rest rebuilds the app.

## If something goes wrong

- **A command "isn't found"** (for example `command not found: pnpm`): close Terminal completely, reopen it, and try that command again. Newly installed tools sometimes need a fresh Terminal window.
- **`pnpm install` or `build:gui` ends with red error text**: try running the two commands again — a dropped download is the most common cause and re-running usually fixes it.
- **You can't find the `.dmg`**: make sure you're inside the project folder first by running `cd ~/Downloads/pmce`, then run the `open` command from Step 6 again.
- **Still stuck?** Copy the last chunk of text from Terminal and open an issue at https://github.com/phn-cloudsnake/pmce/issues so someone can help.
