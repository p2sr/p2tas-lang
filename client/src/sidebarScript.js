// This script will be run within the webview itself
// It cannot access the main VS Code APIs directly.

const vscode = acquireVsCodeApi();

const defaultButtonBackground = getComputedStyle((document.querySelector(":root"))).getPropertyValue("--vscode-button-background");

const socketStatusText = document.querySelector("#status");

const dataStatusText = document.querySelector("#data-status");
const dataRateText = document.querySelector("#data-rate");
const dataTickText = document.querySelector("#data-tick");

const dataDiv = document.querySelector("#server-data");
const buttonsDiv = document.querySelector("#buttons");

const connectButton = document.querySelector("#connect-button");
const playButton = document.querySelector("#start-stop-button");
const pauseButton = document.querySelector("#pause-resume-button");
const tickAdvanceButton = document.querySelector("#tick-advance-button");
const rateButton = document.querySelector("#rate-button");
const rateBox = document.querySelector("#rate-input");
const skipButton = document.querySelector("#skip-button");
const skipBox = document.querySelector("#skip-input");
const pauseatButton = document.querySelector("#pauseat-button");
const pauseatBox = document.querySelector("#pauseat-input");

// Values for storing playback data
let playbackRate = rateBox.value;
let skipToTick = skipBox.value;
let pauseAtTick = pauseatBox.value;

connectButton.addEventListener('click', () => {
    if (connectButton.innerText === "Connect") {
        vscode.postMessage({ type: 'connect' });
    } else {
        vscode.postMessage({ type: 'disconnect' });
    }
});

playButton.addEventListener('click', () => {
    if (dataStatusText.innerText === "Inactive") {
        vscode.postMessage({ type: 'playTAS' });
    } else {
        vscode.postMessage({ type: 'stopTAS' });
    }
});

pauseButton.addEventListener('click', () => {
    if (dataStatusText.innerText === "Playing") {
        vscode.postMessage({ type: 'pauseTAS' });
    } else if (dataStatusText.innerText === "Paused") {
        vscode.postMessage({ type: 'resumeTAS' });
    }
});

tickAdvanceButton.addEventListener('click', () => {
    vscode.postMessage({ type: 'tickAdvance' });
});

rateBox.addEventListener('keyup', key => {
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
    rateButton.classList.add("unchanged"); // Hide set button
    rateButton.tabIndex = -1; // Make set button untabbable
    document.activeElement.blur(); // Remove focus from button
});

skipBox.addEventListener('keyup', key => {
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
    skipButton.classList.add("unchanged"); // Hide set button
    skipButton.tabIndex = -1; // Make set button untabbable
    document.activeElement.blur(); // Remove focus from button
});

pauseatBox.addEventListener('keyup', key => {
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
    pauseatButton.classList.add("unchanged"); // Hide set button
    pauseatButton.tabIndex = -1; // Make set button untabbable
    document.activeElement.blur(); // Remove focus from button
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
        socketStatusText.style.color = "var(--vscode-charts-red)";
        socketStatusText.innerText = "Disconnected";
        connectButton.innerText = "Connect";
        dataDiv.style.display = "none";
        buttonsDiv.style.display = "none";
        return;
    }

    if (message.connected) {
        socketStatusText.style.color = "var(--vscode-charts-green)";
        socketStatusText.innerText = "Connected";
        connectButton.innerText = "Disconnect";
        dataDiv.style.display = "";
        buttonsDiv.style.display = "flex";
    } else {
        socketStatusText.style.color = "var(--vscode-charts-red)";
        socketStatusText.innerText = "Disconnected";
        connectButton.innerText = "Connect";
        dataDiv.style.display = "none";
        buttonsDiv.style.display = "none";
    }

    dataStatusText.innerText = message.state;
    dataRateText.innerText = message.rate;
    dataTickText.innerText = message.currentTick;

    switch (message.state) {
        case "Inactive":
            playButton.innerText = "Play TAS";
            pauseButton.innerText = "Pause TAS";

            pauseButton.disabled = true;
            pauseButton.style.backgroundColor = "#444444";
            tickAdvanceButton.disabled = true;
            tickAdvanceButton.style.backgroundColor = "#444444";

            dataStatusText.style.color = "var(--vscode-charts-lines)";
            break;

        case "Playing":
            playButton.innerText = "Stop TAS";
            pauseButton.innerText = "Pause TAS";

            pauseButton.disabled = false;
            pauseButton.style.background = defaultButtonBackground;
            tickAdvanceButton.disabled = true;
            tickAdvanceButton.style.backgroundColor = "#444444";

            dataStatusText.style.color = "var(--vscode-charts-green)";
            break;

        case "Paused":
            playButton.innerText = "Stop TAS";
            pauseButton.innerText = "Resume TAS";

            pauseButton.disabled = false;
            pauseButton.style.background = defaultButtonBackground;
            tickAdvanceButton.disabled = false;
            tickAdvanceButton.style.backgroundColor = defaultButtonBackground;

            dataStatusText.style.color = "var(--vscode-charts-yellow)";
            break;

        case "Skipping":
            playButton.innerText = "Stop TAS";
            pauseButton.innerText = "Pause TAS";

            pauseButton.disabled = false;
            pauseButton.style.background = defaultButtonBackground;
            tickAdvanceButton.disabled = true;
            tickAdvanceButton.style.backgroundColor = "#444444";

            dataStatusText.style.color = "var(--vscode-charts-blue)";
            break;
    }
}

function changeRate() {
    rate = +rateBox.value;
    vscode.postMessage({ type: 'changeRate', rate: rate });
    playbackRate = rateBox.value;
}

function fastForward() {
    tick = +skipBox.value;
    vscode.postMessage({ type: 'fastForward', tick: tick });
    skipToTick = skipBox.value;
}

function nextPause() {
    tick = +pauseatBox.value;
    vscode.postMessage({ type: 'nextPause', tick: tick });
    pauseAtTick = pauseatBox.value;
}
