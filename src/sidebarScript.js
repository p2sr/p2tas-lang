// This script will be run within the webview itself
// It cannot access the main VS Code APIs directly.

(function () {
    const vscode = acquireVsCodeApi();

    const socketStatusText = (document.getElementById("status"));

    const dataStatusText = document.getElementById("data-status");
    const dataRateText = document.getElementById("data-rate");
    const dataTickText = document.getElementById("data-tick");

    const dataDiv = document.getElementById("server-data");
    const buttonsDiv = document.getElementById("buttons");

    const connectButton = (document.getElementById("connect-button"));
    const playButton = (document.getElementById("start-stop-button"));
    const pauseButton = (document.getElementById("pause-resume-button"));
    const tickAdvanceButton = (document.getElementById("tick-advance-button"));
    const rateButton = (document.getElementById("rate-button"));
    const rateBox = document.getElementById("rate-input");
    const skipButton = (document.getElementById("skip-button"));
    const skipBox = document.getElementById("skip-input");
    const pauseatButton = (document.getElementById("pauseat-button"));
    const pauseatBox = document.getElementById("pauseat-input");

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
        // TODO: grey out button when inactive
        if (dataStatusText.innerText === "Playing") {
            vscode.postMessage({ type: 'pauseTAS' });
        } else if (dataStatusText.innerText === "Paused") {
            vscode.postMessage({ type: 'resumeTAS' });
        }
    });

    tickAdvanceButton.addEventListener('click', () => {
        // TODO: grey out button when not paused
        // if (dataStatusText.innerText === "Paused") {
            vscode.postMessage({ type: 'tickAdvance' });
        // }
    });

    rateButton.addEventListener('click', () => {
        rate = +rateBox.value;
        vscode.postMessage({ type: 'changeRate', rate:rate });
    });

    skipButton.addEventListener('click', () => {
        tick = +skipBox.value;
        vscode.postMessage({ type: 'nextPause', tick:tick  });
    });

    pauseatButton.addEventListener('click', () => {
        tick = +pauseatBox.value;
        vscode.postMessage({ type: 'nextPause', tick:tick  });
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
        if (message.connected) {
            socketStatusText.style.color = "green";
            socketStatusText.innerText = "Connected";
            connectButton.innerText = "Disconnect";
            dataDiv.style.display = "initial";
            buttonsDiv.style.display = "initial";
        } else {
            socketStatusText.style.color = "red";
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
                // TODO: grey out pause button
                break;

            case "Playing":
                playButton.innerText = "Stop TAS";
                pauseButton.innerText = "Pause TAS";
                break;

            case "Paused":
                playButton.innerText = "Stop TAS";
                pauseButton.innerText = "Resume TAS";
                break;

            case "Skipping":
                playButton.innerText = "Stop TAS";
                pauseButton.innerText = "Pause TAS";
                break;
        }
    }

}())
