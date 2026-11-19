"use strict";

// EXPERIMENT CONFIGURATION

// analaysevragen in volgorde waarin ze worden getoond
const questions = [
    "Example question 1: what pattern do you observe?",
    "Example question 2: which activities occur frequently?",
    "Example question 3: what differences do you observe?",
    "Example question 4: what can you conclude?",
    "Example question 5: which cases stand out?",
    "Example question 6: what other patterns do you identify?"
];

// sleutel voor tijdelijke opslag
const storageKey = "dottedChartExperimentV1";

// hulpfunctie om HTML elementen te selecteren via hun ID
const $ = id => document.getElementById(id);

// EXPERIMENT STATE

// huidige toestand en antwoorden van de deelnemer bijhouden
let state = {
    participantId: "",
    currentIndex: 0,
    questionStart: null,
    responses: [],
    selectedLoad: null,
    draftAnswer: "",
    completed: false
};

// LOCAL STORAGE

// huidige experimentgegevens tijdelijk bewaren in de browser
function saveState() {
    localStorage.setItem(storageKey, JSON.stringify(state));
}

// eerder opgeslagen experimentgegevens herstellen bij herladen
function restoreState() {
    try {
        const saved = JSON.parse(localStorage.getItem(storageKey));

        if (
            saved &&
            typeof saved.participantId === "string" &&
            Array.isArray(saved.responses) &&
            Number.isInteger(saved.currentIndex) &&
            saved.currentIndex >= 0 &&
            saved.currentIndex <= questions.length
        ) {
            state = saved;
        }
    } catch (error) {
        console.warn("Could not restore experiment data.", error);
    }
}


// EXPERIMENT SECTIONS

// enkel het gewenste onderdeel van de experimentinterface tonen
function showSection(sectionId) {
    ["participantSetup", "questionInterface", "experimentComplete"]
        .forEach(id => {
            $(id).hidden = id !== sectionId;
        });
}


// MENTAL LOAD SCALE

// schaal van 1 tot 10 aanmaken en de geselecteerde score bijhouden
function renderMentalLoad() {
    const container = $("mentalLoadScale");

    // bestaande knoppen verwijderen
    container.replaceChildren();

    // voor iedere score een knop aanmaken
    for (let value = 1; value <= 10; value++) {
        const button = document.createElement("button");

        button.type = "button";
        button.textContent = value;
        button.className = "mentalLoadButton";

        // geselecteerde score visueel aanduiden
        if (state.selectedLoad === value) {
            button.classList.add("selected");
        }

        button.setAttribute("aria-pressed",
            String(state.selectedLoad === value));
        
        // score registreren wanneer deelnemer deze aanklikt
        button.addEventListener("click", () => {
            state.selectedLoad = value;
            saveState();
            renderMentalLoad();
        });

        container.appendChild(button);
    }
}

// DISPLAY QUESTIONS

// huidige vraag, voortgang en antwoordvelden weergeven
function renderQuestion() {
    if(state.completed) {
        showSection("experimentComplete");
        return;
    }

    showSection("questionInterface");

    const index = state.currentIndex;
    const total = questions.length;

    // vraagnummer en voortgangsbalk bijwerken
    $("questionCounter").textContent =
        `Question ${index + 1} / ${total}`;
    
    $("progressFill").style.width =
    `${((index + 1) / total) * 100}%`;

    // vraagtekst en eventueel eerder ingevuld antwoord tonen
    $("questionHeading").textContent =
    `Question ${index + 1}`;

    $("questionText").textContent = questions[index];

    $("questionAnswer").value = state.draftAnswer || "";

    // koptekst aanpassen bij laatste vraag
    $("nextQuestion").textContent =
    index === total - 1
      ? "Finish and export CSV"
      : "Next question";

    $("experimentMessage").textContent = "";

    renderMentalLoad();
}

// CSV FORMATTING

// waarden correct formatteren voor opslag in een CSV bestand
function csvValue(value) {
    const text = String(value ?? "");
    return '"' + text.replace(/"/g, '""') + '"';
}

// EXPORT RESULTS

// alle antwoorden van de deelnemer exporteren naar een CSV bestand
function exportCSV() {

    // kolommen die worden opgenomen in de export
    const columns = [
        "participant_id",
        "visualization_version",
        "question_number",
        "question",
        "answer",
        "mental_load",
        "question_start",
        "question_end",
        "duration_seconds",
        "duration_minutes"
    ];

    // CSV inhoud opbouwen met één rij per beantwoorde vraag
    const lines = [
        columns.join(","),
        ...state.responses.map(response =>
            columns.map(column => csvValue(response[column])).join(",")
        )
    ];

    const csvContent = "\uFEFF" + lines.join("\r\n");

    // CSV bestand aanmaken en download starten
    const blob = new Blob([csvContent], {
        type: "text/csv;charset=utf-8;"
    });

    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");

    link.href = url;
    link.download = `experiment_${state.participantId}.csv`;

    document.body.appendChild(link);
    link.click();
    link.remove();

    // tijdelijke downloadlink verwijderen
    setTimeout(() => URL.revokeObjectURL(url), 1000);
}


// START EXPERIMENT

// nieuwe deelnemer registreren en eerste analysevraag starten
function startExperiment() {
  const id = $("participantId").value.trim();

  // controleren of participant ID geldig is
  if (!/^[A-Za-z0-9_]+$/.test(id)) {
    alert("Please enter a valid participant ID, e.g. P001.");
    return;
  }

  // experimentgegevens initialiseren
  state = {
    participantId: id,
    currentIndex: 0,
    questionStart: new Date().toISOString(),
    responses: [],
    selectedLoad: null,
    draftAnswer: "",
    completed: false
  };

  saveState();
  renderQuestion();
}


// NEXT QUESTION

// antwoord, mental load en tijdsregistratei van de huidige vraag opslaan
function nextQuestion() {
  const answer = $("questionAnswer").value.trim();

  // controleren of deelnemer antwoord heeft ingevuld
  if (!answer) {
    $("experimentMessage").textContent =
      "Please provide an answer before continuing.";
    return;
  }

  // controleren of een mental load score werd geselecteerd
  if (state.selectedLoad === null) {
    $("experimentMessage").textContent =
      "Please select your mental load rating.";
    return;
  }

  // eindtijd registreren en tijdsduur berekenen
  const end = new Date().toISOString();
  const start = state.questionStart;

  const duration =
    (new Date(end) - new Date(start)) / 1000;

// resultaten van de huidige vraag toevoegen
  state.responses.push({
    participant_id: state.participantId,
    visualization_version: "improved_D3",
    question_number: state.currentIndex + 1,
    question: questions[state.currentIndex],
    answer: answer,
    mental_load: state.selectedLoad,
    question_start: start,
    question_end: end,
    duration_seconds: duration.toFixed(2),
    duration_minutes: (duration / 60).toFixed(2)
  });

  // naar de volgende vraag gaan
  state.currentIndex++;

  // experiment afronden wanneer alle vragen zijn beantwoord
  if (state.currentIndex >= questions.length) {
    state.completed = true;
    state.draftAnswer = "";
    saveState();
    exportCSV();
    showSection("experimentComplete");
    return;
  }

  // beginmoment van de volgende vraag registreren
  state.questionStart = new Date().toISOString();

  // antwoord en mental load selectie opnieuw leegmaken
  state.selectedLoad = null;
  state.draftAnswer = "";

  saveState();
  renderQuestion();
}

// NEW PARTICIPANT

// experimentinterface opnieuw instellen voor de volgende deelnemer
function newParticipant() {
  if (!state.completed) {
    return;
  }

  // tijdelijk opgeslagen gegevens verwijderen
  localStorage.removeItem(storageKey);

  // pagina herladen zodat alle visualisatie-instellingen worden hersteld
  window.location.reload();
}

// EVENT LISTENERS

// experiment starten
$("startExperiment").addEventListener("click", startExperiment);

// huidige vraag indienen en doorgaan naar de volgende
$("nextQuestion").addEventListener("click", nextQuestion);


// CSV bestand opnieuw downloaden
$("downloadResults").addEventListener("click", exportCSV);

// experiment voorbereiden voor de volgende deelnemer
$("newParticipant").addEventListener("click", newParticipant);

// getypt antwoord tussentijds bewaren
$("questionAnswer").addEventListener("input", function() {
  state.draftAnswer = this.value;
  saveState();
});

// INITIALIZATION

// eerder opgeslagen gegevens ophalen
restoreState();

// juiste scherm tonen afhankelijk van de experimentstatus
if (state.participantId) {
  if (state.completed) {
    showSection("experimentComplete");
  } else {
    renderQuestion();
  }
} else {
  showSection("participantSetup");
}