// This script will be run within the webview itself
// It cannot access the main VS Code APIs directly.

const vscode = acquireVsCodeApi();

const dataStatusText = document.querySelector("#data-status");
const dataTickText = document.querySelector("#data-tick");

const connectButton = document.querySelector("#connect-button");

const buttonsDiv = document.querySelector("#buttons");

const stopButton = document.querySelector("#stop-button");
const playRawButton = document.querySelector("#raw-button");
const playButton = document.querySelector("#start-button");
const replayButton = document.querySelector("#replay-button");
const tickAdvanceButton = document.querySelector("#tick-advance-button");

const rateButton = document.querySelector("#rate-button");
const rateSlider = document.querySelector("#rate-input-slider");
const rateBox = document.querySelector("#rate-input-text");
const skipButton = document.querySelector("#skip-button");
const skipBox = document.querySelector("#skip-input");
const pauseatButton = document.querySelector("#pauseat-button");
const pauseatBox = document.querySelector("#pauseat-input");

const linkButton = document.querySelector("#link");
const linkIndicator = document.querySelector("#link-disabled");

var confirmFieldChanges = true;

// Runtime data
let connected = false;
let pauseatSkipLink = true;

let playbackRate = rateBox.value;
let skipToTick = skipBox.value;
let pauseAtTick = pauseatBox.value;

connectButton.addEventListener('click', () => {
    if (connected) {
        vscode.postMessage({ type: 'disconnect' });
    } else {
        vscode.postMessage({ type: 'connect' });
    }
});

playButton.addEventListener('click', () => {
    if (dataStatusText.innerText === "Inactive") {
        // Not playing, start a new playback
        vscode.postMessage({ type: 'playToolsTAS' });
    } else if (dataStatusText.innerText === "Playing") {
        // Playing, pause the playback
        vscode.postMessage({ type: 'pauseTAS' });
    } else if (dataStatusText.innerText === "Paused") {
        // Paused, resume the playback
        vscode.postMessage({ type: 'resumeTAS' });
    }
});

stopButton.addEventListener('click', () => {
    vscode.postMessage({ type: 'stopTAS' });
});

replayButton.addEventListener('click', () => {
    vscode.postMessage({ type: 'stopTAS' });

    if (rawPlayback) {
        vscode.postMessage({ type: 'playRawTAS' });
    } else {
        vscode.postMessage({ type: 'playToolsTAS' });
    }
});

playRawButton.addEventListener('click', () => {
    if (playRawButton.getAttribute("disabled") === "true") return;
    vscode.postMessage({ type: 'playRawTAS' });
});

tickAdvanceButton.addEventListener('click', () => {
    if (tickAdvanceButton.getAttribute("disabled") === "true") return;
    vscode.postMessage({ type: 'tickAdvance' });
});

rateSlider.addEventListener('input', () => {
    rateBox.value = rateSlider.value;

    /*
     * Initially, the slider would automatically submit the new value to the server
     * immediately after change. However, me and rainboww both think it is a better
     * idea to wait with sending the new value to the server until the user presses
     * the apply button. When we have the apply button in the first place, it makes
     * sense to also use it here. If you still want to automatically send the value
     * to the server as it is changed, replace this whole method with a call to the
     * changeRate() method (line 78 to line 88). Eventually when settings are added
     * in the future, this will probably be opt-out. - Soni
     */
});

rateSlider.addEventListener('mouseup', event => {
    if (event.button !== 0) return;

    if (!confirmFieldChanges) {
        changeRate();
        return;
    }

    // Then, set the visibility of the checkmark for the user to confirm the change
    if (rateBox.value !== playbackRate) { // Check if value has changed
        rateButton.classList.remove("unchanged"); // Show set button
        rateButton.tabIndex = 0; // Make set button tabbable
    } else {
        rateButton.classList.add("unchanged"); // Hide set button
        rateButton.tabIndex = -1; // Make set button untabbable
    }
});

rateBox.addEventListener('keyup', key => {
    if (!confirmFieldChanges) {
        changeRate();
        return;
    }

    if (key.code === "Enter") changeRate();

    if (rateBox.value !== playbackRate) { // Check if value has changed
        rateButton.classList.remove("unchanged"); // Show set button
        rateButton.tabIndex = 0; // Make set button tabbable
    } else {
        rateButton.classList.add("unchanged"); // Hide set button
        rateButton.tabIndex = -1; // Make set button untabbable
    }
});

rateButton.addEventListener('click', () => {
    changeRate();
});

rateButton.addEventListener('keyup', key => {
    if (key.code === "Enter") changeRate();
});

skipBox.addEventListener('keyup', key => {
    if (!confirmFieldChanges) {
        fastForward();
        return;
    }

    if (key.code === "Enter") fastForward();

    if (skipBox.value !== skipToTick) { // Check if value has changed
        skipButton.classList.remove("unchanged"); // Show set button
        skipButton.tabIndex = 0; // Make set button tabbable
    } else {
        skipButton.classList.add("unchanged"); // Hide set button
        skipButton.tabIndex = -1; // Make set button untabbable
    }
});

skipButton.addEventListener('click', () => {
    fastForward();
});

skipButton.addEventListener('keyup', key => {
    if (key.code === "Enter") fastForward();
});

pauseatBox.addEventListener('keyup', key => {
    if (!confirmFieldChanges) {
        nextPause();
        return;
    }

    if (key.code === "Enter") nextPause();

    if (pauseatBox.value !== pauseAtTick) { // Check if value has changed
        pauseatButton.classList.remove("unchanged"); // Show set button
        pauseatButton.tabIndex = 0; // Make set button tabbable
    } else {
        pauseatButton.classList.add("unchanged"); // Hide set button
        pauseatButton.tabIndex = -1; // Make set button untabbable
    }
});

pauseatButton.addEventListener('click', () => {
    nextPause();
});

pauseatButton.addEventListener('keyup', key => {
    if (key.code === "Enter") nextPause();
});

linkButton.addEventListener('click', () => {
    pauseatSkipLink = !pauseatSkipLink;

    if (pauseatSkipLink) {
        // Update UI
        linkIndicator.classList.add("invisible");
        pauseatBox.disabled = true;

        // Sync values
        fastForward();
    } else {
        linkIndicator.classList.remove("invisible");
        pauseatBox.disabled = false;
    }
});

// Attempt to restore state
const lastMessage = vscode.getState();
if (lastMessage) {
    handleMessage(lastMessage);
}

window.addEventListener('message', event => {
    const message = event.data;
    vscode.setState(message);
    handleMessage(message);
});

function handleMessage(message) {
    // Reset UI
    if (message.reset === null) {
        buttonsDiv.style.display = "none";
        return;
    }

    // Set visibility of buttons
    if (message.connected) {
        connectButton.classList.remove("disconnected");
        buttonsDiv.style.display = "flex";
    } else {
        connectButton.classList.add("disconnected");
        buttonsDiv.style.display = "none";
    }

    // Store connection status
    connected = message.connected;

    // Display server status
    dataStatusText.innerText = message.state;
    dataTickText.innerText = message.currentTick;

    // Check message state
    switch (message.state) {
        case "Inactive":
            setPlayImage(false);

            playRawButton.setAttribute("disabled", false);
            tickAdvanceButton.setAttribute("disabled", true);

            dataTickText.innerText = "N/A";

            dataStatusText.style.color = "var(--vscode-charts-lines)";
            dataTickText.style.color = "var(--vscode-charts-lines)";
            break;

        case "Playing":
            setPlayImage(true);

            playRawButton.setAttribute("disabled", true);
            tickAdvanceButton.setAttribute("disabled", true);

            dataStatusText.style.color = "var(--vscode-charts-green)";
            dataTickText.style.color = "";
            break;

        case "Paused":
            setPlayImage(false);

            playRawButton.setAttribute("disabled", true);
            tickAdvanceButton.setAttribute("disabled", false);

            dataStatusText.style.color = "var(--vscode-charts-yellow)";
            dataTickText.style.color = "";
            break;

        case "Skipping":
            setPlayImage(true);

            playRawButton.setAttribute("disabled", true);
            tickAdvanceButton.setAttribute("disabled", true);

            dataStatusText.style.color = "var(--vscode-charts-blue)";
            dataTickText.style.color = "";
            break;
    }

    // Check if the server is disconnected
    if (!message.connected) {
        // Display server status
        dataStatusText.innerText = "Disconnected";
        dataTickText.innerText = "N/A";

        // Set status styling
        dataStatusText.style.color = "var(--vscode-charts-red)";
        dataTickText.style.color = "var(--vscode-charts-lines)";
    }

    confirmFieldChanges = message.confirmFieldChanges;
}

function changeRate() {
    let rate = +rateBox.value;
    vscode.postMessage({ type: 'changeRate', rate: rate });
    playbackRate = rateBox.value;
    if (confirmFieldChanges) unfocusButton(rateButton);
}

function fastForward() {
    let tick = +skipBox.value;
    vscode.postMessage({ type: 'fastForward', tick: tick, pauseAfter: pauseatSkipLink });
    skipToTick = skipBox.value;

    // Set pauseat if linked
    if (pauseatSkipLink) {
        pauseAtTick = skipBox.value;
        pauseatBox.value = skipBox.value;
    }

    if (confirmFieldChanges) unfocusButton(skipButton);
}

function nextPause() {
    let tick = +pauseatBox.value;
    vscode.postMessage({ type: 'nextPause', tick: tick });
    pauseAtTick = pauseatBox.value;
    if (confirmFieldChanges) unfocusButton(pauseatButton);
}

function setPlayImage(playing) {
    if (playing) {
        playButton.src = playButton.getAttribute("data-src-pause");
    } else {
        playButton.src = playButton.getAttribute("data-src-play");
    }
}

function unfocusButton(button) {
    button.classList.add("unchanged"); // Hide button
    button.tabIndex = -1; // Make button untabbable
    document.activeElement.blur(); // Remove focus from button
}