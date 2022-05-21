# p2tas-lang

Syntax highlighting, snippets and autocompletion for the Portal 2 TAS files.

## Release Notes
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
- Added support for nopitchlock
- Added integration with in-game playback
    - Implementation of the tas client protocol
    - Added commands to control playback
    - Added sidebar with a sexy UI (based on david072's previous work)

### 0.4.0
- Added decel tool
- Added hover that shows absolute tick when hovering before the `>` in a framebulk (thanks to david072)
- Added command that asks for an absolute tick and inserts an empty framebulk as a relative tick (thanks to david072)

### 0.3.0
- Added syntax from the 1.12.4 sar update

### 0.2.0
- Added comment coloring
- Added coloring and completion for `autoaim` and `setang`
- Snippet for an empty framebulk

### 0.1.0
- Introduced basic highlighting, snippets, and auto completion
