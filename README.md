# Portal 2 TAS Tools

[![CI](https://github.com/p2sr/p2tas-lang/workflows/CI/badge.svg)](https://github.com/p2sr/p2tas-lang/actions?query=workflow%3ACI+branch%3Amaster)

Syntax highlighting, snippets and autocompletion for the Portal 2 TAS files, using the [SourceAutoRecord](https://github.com/p2sr/SourceAutoRecord) plugin.

## Installation

1. Go to the [Marketplace](https://marketplace.visualstudio.com/items?itemName=Portal2SpeedrunningHub.p2tas) or search for "Portal 2 TAS Tools" in the extensions tab in Visual Studio Code
2. Press "Install"

## Building

1. Install packages using `npm install` in the root directory
2. Run the extension and language server using the "Run and Debug" feature of VSCode. Selecting "Client + Server" will create a new VSCode session with the extension installed, as well as start the language server and connect a debugger to both.

## Release Notes

### 1.4.2

- Add support for version 7
- Add support for setang easing types
- Fix toggle tick with empty lines before

### 1.4.1

- Add support for version 6
- Fix various bugs relating to scripts starting with comments/empty lines
- Fix active tools display that was still displaying when empty

### 1.4.0

- New features:
  - Debug tick highlight (mlugg)
- Syntax changes:
  - Add support for version 5 (mlugg)
- Fix tool duration for `setang` and `check` (mlugg)

### 1.3.0

- Syntax changes:
  - Add support for version 3 and 4
  - Add support for tools-only bulk
  - Add support for `rngmanip` line
  - Add support for `letspeedlock`
  - Add support for `autoaim ent` (david072)
- Add settings (david072):
  - Turning off language server diagnostics
  - Confirm for input in the sidebar
  - Hiding active tools
- Other editor features (david072):
  - Order active tools by processing order for version 3+
  - Don't highlight tools in the commands field
  - Code folding for repeat blocks
  - Add completion for version
- A heap of bug fixes (david072)

### 1.2.0

- Sidebar improvements
  - Button to play raw TAS (Blenderiste09)
  - Music player UI (soni801)
- New snippets (Blenderiste09)
- Save on TAS playback
- Parsing and syntax highlighting
  - Add support for `version` (mlugg)
  - Add support for new `start next` syntax (mlugg)
  - Add a command to toggle tick type (david072)
  - Add support for the `check` tool (david072)
  - Complete language server rewrite (david072)

### 1.1.0

- Improved sidebar UI (thanks to soni801)
  - Added replay button
  - Hotter UI
  - Press enter to confirm in input fields

### 1.0.0

- Added language server (thanks to david072)
  - Provides errors and warnings
  - Provides better completion
  - Provides documentation hovers

### 0.5.0

- Added active tools display (thanks to david072)
- Added support for `nopitchlock`
- Added integration with in-game playback
  - Implementation of the tas client protocol
  - Added commands to control playback
  - Added sidebar with a sexy UI (based on david072's previous work)

### 0.4.0

- Added `decel` tool
- Added hover that shows absolute tick when hovering before the `>` in a framebulk (thanks to david072)
- Added command that asks for an absolute tick and inserts an empty framebulk as a relative tick (thanks to david072)

### 0.3.0

- Added syntax from the [1.12.4 SAR update](https://github.com/p2sr/SourceAutoRecord/releases/tag/1.12.4)

### 0.2.0

- Added comment coloring
- Added coloring and completion for `autoaim` and `setang`
- Snippet for an empty framebulk

### 0.1.0

- Introduced basic highlighting, snippets, and auto completion
