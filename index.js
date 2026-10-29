const {
  select,
  csv,
  extent,
  scaleTime,
  scaleBand,
  axisBottom,
  axisLeft,
  timeFormat,
  scaleOrdinal,
  schemeCategory10,
  timeMinute,
  ascending,
  zoom,
} = d3;

const svg = select('.chartArea svg'); // het SVG element uit onze HTML selecteren
const width = +svg.attr('width'); // breedte van het SVG element ophalen

// hoogte van de filter bepalen
const controlsHeight =
  document.querySelector('.controls').offsetHeight;

// beschikbare hoogte van het scherm gebruiken
const height = window.innerHeight - controlsHeight - 20;

svg.attr('height', height);


const tooltip = select('body') // tooltip maken voor extra info bij hover
  .append('div') // informatievenster
  .attr('class','eventTooltip')
  .style('visibility','hidden');

// marges rond de visualisatie bepalen
const margin = {
  top: 50,
  right: 40,
  bottom: 70,
  left: 120,
};

// gebied waarin we effectief kunnen tekenen
const innerWidth = width - margin.left - margin.right;
const innerHeight = height - margin.top - margin.bottom;

// de dataset inladen + bewerkingen binnen de data
csv('data_sample_1000.csv').then((data) => {
  // timestamps omzetten van tekst naar datum
  data.forEach((d) => {
    d.timestamp = new Date(d.timestamp.replace(' ', 'T'));
  });

  // informatie per case bijhouden
  const caseInfo = new Map();

  data.forEach((d) => {
    const caseName = d.CASE_concept_name;

    // wanneer we de case nog niet hebben gezien
    if (!caseInfo.has(caseName)) {
      caseInfo.set(caseName, {
        start: d.timestamp,
        end: d.timestamp,
        eventCount: 0,
      });
    }

    const info = caseInfo.get(caseName);
    info.eventCount += 1;

    // kijken of dit event vroeger plaatsvindt dan het huidige eerste
    if (d.timestamp < info.start) {
      info.start = d.timestamp;
    }

    // kijken of dit event later plaatsvindt dan het huidige laatste
    if (d.timestamp > info.end) {
      info.end = d.timestamp;
    }
  });


  // START EN END EVENTS IDENTIFICEREN

  const startEvents = new Set();
  const endEvents = new Set();

  const firstEventPerCase = new Map();
  const lastEventPerCase = new Map();

  data.forEach((d) => {
    const caseName = d.CASE_concept_name;

    const first = firstEventPerCase.get(caseName);
    const last = lastEventPerCase.get(caseName);

    // Eerste event van iedere case

    if (!first || d.timestamp < first.timestamp) {
      firstEventPerCase.set(caseName, d);
    }

    // Laatste event van iedere case
    
    if (!last || d.timestamp > last.timestamp) {
      lastEventPerCase.set(caseName,d);
    }
  });

  firstEventPerCase.forEach((d) => {
    startEvents.add(d);
  })

  lastEventPerCase.forEach((d) => {
    endEvents.add(d);
  });

  // CASE ATTRIBUTES

  const caseAttributes = new Map();

  data.forEach((d) => {

    if (d.activity_id === 'Create Fine') {
      caseAttributes.set(d.CASE_concept_name, {
        initialAmount: Number(d.amount),
        article: String(d.article).trim()
      });
    }
  });

  // ACTIVITY SEQUENCE PER CASE

  const eventsByCase = new Map();

  data.forEach((d) => {
    const caseName = d.CASE_concept_name;

    if (!eventsByCase.has(caseName)) {
      eventsByCase.set(caseName, []);
    }

    eventsByCase.get(caseName).push(d);
  });

  eventsByCase.forEach((events) => {
    events.sort((a,b) =>
      d3.ascending(a.timestamp, b.timestamp)
    );
  });

  // X-AS SETTINGS

  // time mode settings (welke timestamp we gebruiken)
  let timeMode = 'absolute';
  const xValue = (d) => {
    if (timeMode === 'relative') {
      const caseStart = caseInfo.get(d.CASE_concept_name).start;
      const elapsedTime = d.timestamp - caseStart;
      return new Date(elapsedTime);
    }
    return d.timestamp;
  };

  // bepalen welke ons eerste en laatste timestamp is
  const xDomain = extent(data, xValue);
  // tijdsschaal maken voor de x-as
  const xScale = scaleTime()
    .domain(xDomain)
    .range([0, innerWidth]);

  // Y-AS SETTINGS

  // bepalen welke variabele op de y-as komt
  const yValue = (d) => d.CASE_concept_name;

  // alle unieke cases uit de dataset verzamelen
  const cases = Array.from(new Set(data.map(yValue)));

  // cases sorteren volgens opties
  const sortCases = (sortType, direction = 'ascending') => {

  const multiplier = direction === 'descending' ? -1 : 1;

  return [...cases].sort((caseA, caseB) => {

    const infoA = caseInfo.get(caseA);
    const infoB = caseInfo.get(caseB);

    let comparison = 0;

    // SORT BY CASE DURATION
    if (sortType === 'duration') {
      const durationA = infoA.end - infoA.start;
      const durationB = infoB.end - infoB.start;

      comparison = ascending(durationA, durationB);
    }

    // SORT BY START TIME
    else if (sortType === 'startTime') {
      comparison = ascending(infoA.start, infoB.start);
    }

    // SORT BY NUMBER OF EVENTS
    else if (sortType === 'eventCount') {
      comparison = ascending(
        infoA.eventCount,
        infoB.eventCount
      );
    }

    // SORT BY INITIAL FINE AMOUNT
    else if (sortType === 'fineAmount') {

      const amountA =
        caseAttributes.get(caseA)?.initialAmount;

      const amountB =
        caseAttributes.get(caseB)?.initialAmount;

      const validA = Number.isFinite(amountA);
      const validB = Number.isFinite(amountB);

      // Missing values always at the bottom
      if (!validA && !validB) {
        comparison = 0;
      } else if (!validA) {
        return 1;
      } else if (!validB) {
        return -1;
      } else {
        comparison = ascending(amountA, amountB);
      }
    }

    // Use start time when values are equal
    if (comparison === 0) {
      return ascending(infoA.start, infoB.start);
    }

    return comparison * multiplier;
  });
};

  // een schaal maken voor de cases op de y-as
  const yScale = scaleBand()
    .domain(sortCases('startTime'))
    .range([0, innerHeight]);

  const getZoomCaseLabels = (zoomedyScale) => {
    const visibleCases = zoomedyScale
      .domain()
      .filter((caseName) => {
        const y =
          zoomedyScale(caseName) + 
          zoomedyScale.bandwidth() / 2;

        return y >= 0 && y <= innerHeight;
      });
    
    const minimumRowHeight = 10;

    if (
      zoomedyScale.bandwidth() >= minimumRowHeight
    ) {
      return visibleCases;
    }

    return [];
  };


  //const getVisibleCaseLabels = () => {
    //const currentCases = yScale.domain();
    //const maxLabels = 20;
    //const labelStep = Math.ceil(currentCases.length / maxLabels);

    //return currentCases.filter((d, i) => i % labelStep === 0);
  //};

  // bepalen welke kolom de activiteit bevat
  const activityValue = (d) => d.activity_id;

  // alle unieke activiteiten uit de dataset verzamelen
  const activities = Array.from(
    new Set(data.map(activityValue)),
  );

  // kleurschaal maken voor de activiteiten
  const colorScale = scaleOrdinal()
    .domain(activities)
    .range(schemeCategory10);

  // set om activiteiten in te bewaren
  const selectedActivities = new Set();

  const legend = select('#activityLegend');

  const legendItems = legend
    .selectAll('.legendItem')
    .data(activities)
    .enter()
    .append('div')
    .attr('class', 'legendItem');

  const legendDots = legendItems
    .append('svg')
    .attr('width', 14)
    .attr('height', 14);

  legendDots
    .append('circle')
    .attr('cx', 7)
    .attr('cy', 7)
    .attr('r', 5)
    .attr('fill', (d) => colorScale(d));
  
  legendItems
    .append('span')
    .attr('class', 'legendLabel')
    .text((d) => d);

  // GROEP WAARIN WE DE VISUALISATIE GAAN TEKENEN
  const g = svg
    .append('g')
    .attr(
      'transform',
      `translate(${margin.left},${margin.top})`,
    );

  // gebied voor de zoominteractie
  svg
    .append('defs')
    .append('clipPath')
    .attr('id', 'plotClip')
    .append('rect')
    .attr('width', innerWidth)
    .attr('height', innerHeight);

  const plotGroup = g
    .append('g');

  plotGroup.node().style.clipPath = 'url(#plotClip)';

  plotGroup
    .append('rect')
    .attr('width', innerWidth)
    .attr('height', innerHeight)
    .style('fill', 'transparent');


  // we maken een groep voor de x-as + scalen deze + formatting
  // X-as label formatting

  const getTimeTickFormat = () => {
    if (timeMode === 'relative') {
      return (d) => {
        const days =
          d.getTime() / (1000 * 60 * 60 * 24);
        
        return days.toFixed(0) + 'd';
      };
    }

    return timeFormat('%b %Y');
  };

  const xAxisGroup = g
  .append('g')
  .attr('transform', `translate(0,${innerHeight})`)
  .call(
    axisBottom(xScale).tickFormat(getTimeTickFormat()),
  );

  // we maken een groep voor de y-as (formatting gebeurt bij style)
  const yAxisGroup = g
    .append('g')
    .call(
      axisLeft(yScale)
        .tickValues([])
    );

    yAxisGroup
    .select('.domain')
    .attr('d',`M0.5,0V${innerHeight}`);
        

  // voor ieder event in de dataset een cirkel maken
  const circles = plotGroup
    .selectAll('circle')
    .data(data)
    .enter()
    .append('circle')
    .attr('class', 'eventCircle')

    .attr('cx', (d) => xScale(xValue(d))) // x-positie van de cirkels
    .attr(
      'cy',
      (d) => yScale(yValue(d)) + yScale.bandwidth() / 2,
    ) // y-positie
    .attr('r', 2)
    .attr('fill', (d) => colorScale(activityValue(d)))

    // hover-over activeren
    .on('mouseover', function (d) {

 const caseName = d.CASE_concept_name;
  const info = caseInfo.get(caseName);
  const attributes = caseAttributes.get(caseName);
  const caseEvents = eventsByCase.get(caseName);

  // CASE DURATION IN DAYS

  const duration =
    (info.end - info.start) / (1000 * 60 * 60 * 24);

  // TIME SINCE CASE START

  const relativeDays =
    (d.timestamp - info.start) / (1000 * 60 * 60 * 24);

  // FADE OTHER CASES

  circles.attr('opacity', event =>
    event.CASE_concept_name === caseName ? 1 : 0.15
  );

  // ESCAPE VALUES USED IN HTML

  const escapeHTML = value =>
    String(value ?? '')
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');

  // ACTIVITY SEQUENCE

  const sequenceHTML = caseEvents
    .map(event => `
      <div class="tooltipSequenceItem">
        <span class="tooltipDot"
          style="background:${colorScale(event.activity_id)}">
        </span>
        <span>${escapeHTML(event.activity_id)}</span>
      </div>
    `)
    .join('');

  // CASE ATTRIBUTES

  const amount =
    attributes &&
    Number.isFinite(attributes.initialAmount)
      ? `€ ${attributes.initialAmount.toFixed(2)}`
      : 'N/A';

  const article =
    attributes
      ? escapeHTML(attributes.article)
      : 'N/A';

  // UPDATE TOOLTIP

  tooltip
    .html(`
      <div class="tooltipSubtitle">Case details</div>

      <div class="tooltipCaseId">
        Case ${escapeHTML(caseName)}
      </div>

      <div class="tooltipDivider"></div>

      <div class="tooltipSubtitle">Selected event</div>

      <div class="tooltipEvent">
        <span class="tooltipDot"
          style="background:${colorScale(d.activity_id)}">
        </span>
        ${escapeHTML(d.activity_id)}
      </div>

      <div class="tooltipDate">
        ${timeFormat('%d %b %Y, %H:%M')(d.timestamp)}
      </div>

      <div class="tooltipDate">
        Time since case start:
        ${relativeDays.toFixed(1)} days
      </div>

      <div class="tooltipStats">
        <div class="tooltipStat">
          <div class="tooltipStatLabel">Case duration</div>
          <div class="tooltipStatValue">
            ${duration.toFixed(1)} days
          </div>
        </div>

        <div class="tooltipStat">
          <div class="tooltipStatLabel">Initial fine amount</div>
          <div class="tooltipStatValue">
            ${escapeHTML(amount)}
          </div>
        </div>
      </div>

      <div class="tooltipDivider"></div>

      <div class="tooltipSectionTitle">Article</div>
      <div>${article}</div>

      <div class="tooltipDivider"></div>

      <div class="tooltipSectionTitle">
        Activity sequence
      </div>

      ${sequenceHTML}
    `);


      const tooltipNode = tooltip.node();

      const tooltipWidth = tooltipNode.offsetWidth;
      const tooltipHeight = tooltipNode.offsetHeight;

      const offset = 12;
      const margin = 8;

      const mouseX = d3.event.clientX;
      const mouseY = d3.event.clientY;

      // Default position: right and below the cursor
      let left = mouseX + offset;
      let top = mouseY + offset;

      // Move left if there is insufficient space
      if (left + tooltipWidth > window.innerWidth) {
        left = mouseX - tooltipWidth - offset;
      }

      // Move up if there is insufficient space
      if (top + tooltipHeight > window.innerHeight) {
        top = mouseY - tooltipHeight - offset;
      }

      // Keep the tooltip within the window
      left = Math.max(
        margin,
        Math.min(left, window.innerWidth - tooltipWidth - margin)
      );

      top = Math.max(
        margin,
        Math.min(top, window.innerHeight - tooltipHeight - margin)
      );

      // Apply position and show tooltip
      tooltip
        .style('left', left + 'px')
        .style('top', top + 'px')
        .style('visibility', 'visible');

    })

    // hover-over deactiveren
    .on('mouseout', function (d) {

      // restore visibility of all events
      circles.attr('opacity', 1);

      // hide tooltip
      tooltip.style('visibility', 'hidden');
    });

        // navigatievenster
    const overviewWidth = innerWidth * 0.24;
    const overviewHeight = innerHeight * 0.18;

    const overviewX = innerWidth * 0.74;
    const overviewY = 10;

    const overviewGroup = g
      .append('g')
      .attr(
        'transform',
        `translate(${overviewX},${overviewY})`,)
      .style('pointer-events', 'none');

    // witte achtergrond
    overviewGroup
        .append('rect')
        .attr('width', overviewWidth)
        .attr('height', overviewHeight)
        .attr('fill', 'white')
        .attr('fill-opacity', 0.8)
        .attr('stroke', '#666');

    // schaal voor tijd in het navigatievenster
    const overviewXScale = scaleTime()
      .domain(xScale.domain())
      .range([0, overviewWidth]);
      
    // schaal voor cases in het navigatievenster
    const overviewYScale = scaleBand()
      .domain(yScale.domain())
      .range([0, overviewHeight]);

    // alle events klein weergeven
    const overviewCircles = overviewGroup
      .selectAll('.overviewCircle')
      .data(data)
      .enter()
      .append('circle')
      .attr('class', 'overviewCircle')
      .attr('cx', (d) => overviewXScale(xValue(d)),)
      .attr('cy', (d) => overviewYScale(yValue(d)) + overviewYScale.bandwidth() / 2,)
      .attr('r', 0.7)
      .attr('fill', (d) => colorScale(activityValue(d)),)
      .attr('opacity', 0.6);

    const viewport = overviewGroup
        .append('rect')
        .attr('x',0)
        .attr('y',0)
        .attr('width',overviewWidth)
        .attr('height', overviewHeight)
        .attr('fill', 'white')
        .attr('fill-opacity', 0.08)
        .attr('stroke', '#222')
        .attr('stroke-width', 2);


    // zoomgedrag toevoegen
    const zoomBehavior = zoom()
    .scaleExtent([1,50])
    .extent([[0,0],[innerWidth,innerHeight],])
    .translateExtent([[0,0],[innerWidth,innerHeight],])
    .on('zoom', function() {
      const transform = d3.event.transform;

      // ingezoomde schaal voor x-as
      const zoomedxScale = transform.rescaleX(xScale);

      // ingezoomde schaal voor y-as
      const zoomedyScale = yScale
        .copy()
        .range([
          transform.applyY(0),
          transform.applyY(innerHeight),
        ]);

      // grootte van de geleidelijk aanpassen
      const newRadius = Math.min(4.5, 2 + Math.log2(transform.k)*0.5,);

      // horizontale positie van de bolletjes aanpassen
      circles.attr(
        'cx', 
        (d) => zoomedxScale(xValue(d)),
      );
    
      // verticale positie van de bolletjes aanpassen
      circles.attr(
        'cy',
        (d) => zoomedyScale(yValue(d)) + zoomedyScale.bandwidth() / 2,
      );

      // grootte van de bolletjes aanpassen
      circles.attr('r', newRadius);

      // x-as aanpasen aan nieuwue tijdsperiode
      xAxisGroup.call(
        axisBottom(zoomedxScale)
        .tickFormat(getTimeTickFormat())
      );

      // bepalen welke case labels zichtbaar mogen zijn (y-as)
       const visibleLabels = getZoomCaseLabels(zoomedyScale);
       
       // y-as aanpassen aan nieuwe schaal
       yAxisGroup.call(
        axisLeft(zoomedyScale)
          .tickValues(visibleLabels),
      ); 

      // verticale lijn van de y-as begrenzen
      yAxisGroup
        .select('.domain')
        .attr('d',`M0.5,0V${innerHeight}`);

      const viewportX =
        transform.invertX(0) / innerWidth * overviewWidth;
      
      const viewportY =
        transform.invertY(0) / innerHeight * overviewHeight;
      
      const viewportWidth =
        overviewWidth / transform.k;
      
      const viewportHeight =
        overviewHeight / transform.k;
      
      viewport
        .attr('x', viewportX)
        .attr('y', viewportY)
        .attr('width', viewportWidth)
        .attr('height', viewportHeight);
    });

    plotGroup.call(zoomBehavior);

    select('#resetZoom').on('click', function() {
      plotGroup.call(
        zoomBehavior.transform,
        d3.zoomIdentity,
      );
    });

  // REAGEREN OP SORTEEROPTIES
  
  // switch between absolute and relative time mode
  select ('#timeMode').on('change', function() {
    timeMode = this.value;

    // determine the new time domain
    const newXDomain = extent(data, xValue);

    // update main x scale
    xScale.domain(newXDomain);

    // update overview x scale
    overviewXScale.domain(newXDomain);

    // reposition events in the overview
    overviewCircles.attr(
      'cx',
      (d) => overviewXScale(xValue(d))
    );

    // reset zoom and update main visualization
    plotGroup.call(
      zoomBehavior.transform,
      d3.zoomIdentity
    );
  });

  // update case sorting

  function updateCaseSorting() {

    const selectedSort =
      select('#sortSelect').property('value');

    const selectedDirection =
      select('#sortDirection').property('value');

    // Determine new case order
    const sortedCases = sortCases(
      selectedSort,
      selectedDirection
    );

    // Update main visualization
    yScale.domain(sortedCases);

    // Update overview navigator
    overviewYScale.domain(sortedCases);

    overviewCircles.attr(
      'cy',
      (d) =>
        overviewYScale(yValue(d)) +
        overviewYScale.bandwidth() / 2
    );

    // Reset zoom and redraw positions
    plotGroup.call(
      zoomBehavior.transform,
      d3.zoomIdentity
    );

    // Preserve filtered case view after sorting

    if (select('#showFilteredCases').property('checked')) {
      updateActivityHighlight();
    }
  }

  // Listen to both dropdowns
  select('#sortSelect').on('change', updateCaseSorting);

  select('#sortDirection').on('change', updateCaseSorting);

 // CASE FILTER SETTINGS

  // case duration filter settings

  const durationByCase = new Map();

  caseInfo.forEach((info,caseName) => {
    const durationDays = (info.end - info.start) / (1000*60*60*24);

    durationByCase.set(caseName, durationDays);
  });

  const allDurations = Array.from(
    durationByCase.values()).sort(d3.ascending);

  const minimumDuration = d3.min(allDurations);
  const maximumDuration = d3.max(allDurations);

  const q1Duration = d3.quantile(allDurations, 0.25);
  const q3Duration = d3.quantile(allDurations, 0.75);

  let selectedMinDuration = minimumDuration;
  let selectedMaxDuration = maximumDuration;

  // amount settings

  const allAmounts = Array.from(caseAttributes.values())
    .map(d => d.initialAmount)
    .filter(Number.isFinite);

  const minimumAmount = Math.min(...allAmounts);
  const maximumAmount = Math.max(...allAmounts);

  let selectedMinAmount = minimumAmount;
  let selectedMaxAmount = maximumAmount;

  const selectedArticles = new Set();

  // INPUT ELEMENTS

  const minAmountInput =
    document.getElementById('minAmount');

  const maxAmountInput =
    document.getElementById('maxAmount');

  const minAmountSlider =
    document.getElementById('minAmountSlider');

  const maxAmountSlider =
    document.getElementById('maxAmountSlider');

  // NONLINEAR AMOUNT SLIDER

  const sliderSteps = 1000;

  // The first 75% represents amounts from minimum to 60
  const sliderPivot = Math.min(
    60,
    maximumAmount
  );

  const pivotPosition = 0.75;

  // Slider position to actual amount

  function sliderToAmount(position) {

    const p = position / sliderSteps;

    if (p <= pivotPosition) {

      return minimumAmount +
        (p / pivotPosition) *
        (sliderPivot - minimumAmount);

    }

    return sliderPivot +
      ((p - pivotPosition) / (1 - pivotPosition)) *
      (maximumAmount - sliderPivot);

  }

  // Actual amount to slider position

  function amountToSlider(amount) {

    if (amount <= sliderPivot) {

      if (sliderPivot === minimumAmount) {
        return 0;
      }

      return (
        (amount - minimumAmount) /
        (sliderPivot - minimumAmount)
      ) * pivotPosition * sliderSteps;

    }

    if (maximumAmount === sliderPivot) {
      return sliderSteps;
    }

    return (
      pivotPosition +
      ((amount - sliderPivot) /
        (maximumAmount - sliderPivot)) *
        (1 - pivotPosition)
    ) * sliderSteps;

  }
// LABELS FOR NONLINEAR AMOUNT SLIDER

const sliderLabels = [
  minimumAmount,
    (minimumAmount + sliderPivot) / 2,
    sliderPivot,
    maximumAmount
];

const labelContainer =
  document.getElementById('amountSliderLabels');

sliderLabels.forEach((amount) => {

  const label = document.createElement('span');
  label.className = 'amountSliderLabel';

  label.textContent = amount.toFixed(2);

  const position = amountToSlider(amount);

  label.style.left =
    (position / sliderSteps * 100) + '%';

  labelContainer.appendChild(label);

});

  // Selected range element

  const selectedRange =
    document.querySelector('.amountSliderSelected');

  // Synchronize sliders, inputs and visual range

  function syncAmountControls() {

    minAmountInput.value =
      selectedMinAmount.toFixed(2);

    maxAmountInput.value =
      selectedMaxAmount.toFixed(2);

    const minPosition =
      amountToSlider(selectedMinAmount);

    const maxPosition =
      amountToSlider(selectedMaxAmount);

    minAmountSlider.value = minPosition;
    maxAmountSlider.value = maxPosition;

    selectedRange.style.left =
      (minPosition / sliderSteps * 100) + '%';

    selectedRange.style.width =
      ((maxPosition - minPosition) /
        sliderSteps * 100) + '%';

  }

  // Minimum slider

  minAmountSlider.addEventListener('input', function() {

    selectedMinAmount = Math.min(
      sliderToAmount(Number(this.value)),
      selectedMaxAmount
    );

    syncAmountControls();
    updateActivityHighlight();

  });

  // Maximum slider

  maxAmountSlider.addEventListener('input', function() {

    selectedMaxAmount = Math.max(
      sliderToAmount(Number(this.value)),
      selectedMinAmount
    );

    syncAmountControls();
    updateActivityHighlight();

  });

  // Manual minimum input

  minAmountInput.addEventListener('change', function() {

    const value = Number(this.value);

    if (
      this.value.trim() !== '' &&
      Number.isFinite(value)
    ) {

      selectedMinAmount = Math.max(
        minimumAmount,
        Math.min(value, selectedMaxAmount)
      );

    }

    syncAmountControls();
    updateActivityHighlight();

  });

  // Manual maximum input

  maxAmountInput.addEventListener('change', function() {

    const value = Number(this.value);

    if (
      this.value.trim() !== '' &&
      Number.isFinite(value)
    ) {

      selectedMaxAmount = Math.min(
        maximumAmount,
        Math.max(value, selectedMinAmount)
      );

    }

    syncAmountControls();
    updateActivityHighlight();

  });

  // Initialize slider

  syncAmountControls();

  // nonlinear case duration slider

  const durationSliderSteps = 1000;
  const durationPivotPosition = 0.75;

  const durationPivot = q3Duration;

  function sliderToDuration(position){
    const p = position / durationSliderSteps;

    if (p <= durationPivotPosition) {
      if (durationPivot === minimumDuration) {
        return minimumDuration;
      }

      return minimumDuration +
        (p / durationPivotPosition) *
        (durationPivot - minimumDuration);
    }

    return durationPivot +
      ((p - durationPivotPosition) /
        (1 - durationPivotPosition)) *
      (maximumDuration - durationPivot);
  }

  function durationToSlider(duration) {

    if (duration <= durationPivot) {
      if (durationPivot === minimumDuration) {
        return 0;
      }

      return (
        (duration - minimumDuration) /
        (durationPivot - minimumDuration))
        * durationPivotPosition * durationSliderSteps;
    }

    if (maximumDuration === durationPivot) {
      return durationSliderSteps;
    }

    return (
      durationPivotPosition +
      ((duration - durationPivot) /
        (maximumDuration - durationPivot)) *
        (1 - durationPivotPosition))
        * durationSliderSteps;
  }

  // DURATION SLIDER LABELS

  const durationLabels = [
    minimumDuration,
    q1Duration,
    q3Duration,
    maximumDuration
  ];

  const durationLabelContainer =
    document.getElementById('durationSliderLabels');

  // Clear existing labels
  durationLabelContainer.innerHTML = '';

  const displayedLabels = [];

  durationLabels.forEach((duration) => {

    const position = durationToSlider(duration);
    const percentage = position / durationSliderSteps * 100;

    // Avoid overlapping labels
    const overlaps = displayedLabels.some(existing =>
      Math.abs(existing - percentage) < 12
    );

    if (overlaps) return;

    displayedLabels.push(percentage);

    const label = document.createElement('span');
    label.className = 'durationSliderLabel';

    label.textContent = duration.toFixed(1);

    label.style.left = percentage + '%';

    if (percentage < 6) {
      label.style.transform = 'translateX(0)';
    } else if (percentage > 94) {
      label.style.transform = 'translateX(-100%)';
    }

    durationLabelContainer.appendChild(label);

  });

  // input elements

  const minDurationInput =
    document.getElementById('minDuration');

  const maxDurationInput =
    document.getElementById('maxDuration');

  const minDurationSlider =
    document.getElementById('minDurationSlider');
  
  const maxDurationSlider =
    document.getElementById('maxDurationSlider');

  const durationSelectedRange =
    document.querySelector('.durationSliderSelected');

  // synchronize controls

  function syncDurationControls() {
    minDurationInput.value =
      selectedMinDuration.toFixed(1);

    maxDurationInput.value =
      selectedMaxDuration.toFixed(1);

    const minPosition =
      durationToSlider(selectedMinDuration);

    const maxPosition =
      durationToSlider(selectedMaxDuration);

    minDurationSlider.value = minPosition;
    maxDurationSlider.value = maxPosition;

    durationSelectedRange.style.left =
      (minPosition / durationSliderSteps * 100) + '%';
    
      durationSelectedRange.style.width =
        ((maxPosition - minPosition) /
          durationSliderSteps * 100) + '%';
  }

  // minimum slider

  minDurationSlider.addEventListener('input', function() {

    selectedMinDuration = Math.min(
      sliderToDuration(Number(this.value)),
      selectedMaxDuration
    );

    syncDurationControls();
    updateActivityHighlight();
  });

  // maximum slider

  maxDurationSlider.addEventListener('input', function() {

    selectedMaxDuration = Math.max(
      sliderToDuration(Number(this.value)),
      selectedMinDuration
    );

    syncDurationControls();
    updateActivityHighlight();
  });

  // Manual minimum input

  minDurationInput.addEventListener('change', function() {

    const value = Number(this.value);

    if (this.value.trim() !== '' &&
        Number.isFinite(value)) {
          
      selectedMinDuration = Math.max(
        minimumDuration, 
        Math.min(value, selectedMaxDuration)
      );
    }

    syncDurationControls();
    updateActivityHighlight();
  });

  // Manual maximum input

  maxDurationInput.addEventListener('change', function() {

    const value = Number(this.value);

    if (this.value.trim() !== '' &&
        Number.isFinite(value)) {
          
      selectedMaxDuration = Math.min(
        maximumDuration,
        Math.max(value, selectedMinDuration)
      );
    }

    syncDurationControls();
    updateActivityHighlight();
  });

  // Initialize duration slider

  syncDurationControls();


  // ARTICLE FILTER + SORTEREN OP FREQUENTIE

  const articleCounts = new Map();

  caseAttributes.forEach((attributes) => {

    const article = attributes.article;

    articleCounts.set(
      article,
      (articleCounts.get(article) || 0) + 1
    );

  });

  const allArticles = Array.from(articleCounts.keys())
    .sort((a, b) => {

      const frequencyDifference =
        articleCounts.get(b) - articleCounts.get(a);

      if (frequencyDifference !== 0) {
        return frequencyDifference;
      }

      return a.localeCompare(
        b,
        undefined,
        { numeric: true }
      );

    });

  const articleDropdownButton =
    document.getElementById('articleDropdownButton');

  const articleDropdownContent =
    document.getElementById('articleDropdownContent');

  // DROPDOWN AUTOMATISCH VULLEN

  allArticles.forEach(article => {

    const label = document.createElement('label');
    label.className = 'articleOption';

    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.value = article;

    const text = document.createElement('span');
    text.textContent = `${article} (${articleCounts.get(article)} cases)`;

    label.appendChild(checkbox);
    label.appendChild(text);

    articleDropdownContent.appendChild(label);

    checkbox.addEventListener('change', function() {

      if (this.checked) {
        selectedArticles.add(article);
      } else {
        selectedArticles.delete(article);
      }

      updateArticleButton();
      updateActivityHighlight();

    });

  });

  function updateArticleButton() {

    if (selectedArticles.size === 0) {
      articleDropdownButton.textContent = 'All articles ▼';
    } else {
      articleDropdownButton.textContent =
        selectedArticles.size + ' article(s) selected ▼';
    }

  }

  articleDropdownButton.addEventListener('click', function() {
    articleDropdownContent.classList.toggle('open');
  });

  // DROPDOWN SLUITEN BIJ KLIK ERBUITEN

  document.addEventListener('click', function(event) {

    if (!event.target.closest('.articleDropdown')) {
      articleDropdownContent.classList.remove('open');
    }

  });

  // RESET CASE FILTERS

  document.getElementById('resetCaseFilters')
    .addEventListener('click', function() {

      selectedMinAmount = minimumAmount;
      selectedMaxAmount = maximumAmount;

      selectedMinDuration = minimumDuration;
      selectedMaxDuration = maximumDuration;

      selectedArticles.clear();

      articleDropdownContent
        .querySelectorAll('input[type="checkbox"]')
        .forEach(checkbox => {
          checkbox.checked = false;
        });

      syncAmountControls();
      syncDurationControls();
      updateArticleButton();
      updateActivityHighlight();

    });


  // KEY NUMBERS

  const totalCasesElement =
    document.getElementById('totalCases');

  const matchingCasesElement =
    document.getElementById('matchingCases');

  const highlightedCasesElement =
    document.getElementById('highlightedCases');

  totalCasesElement.textContent = cases.length;

  // BEGIN FUNCTIE (VOOR HIGHLIGHT ACTIVITEITEN)
// COMBINED HIGHLIGHTING

let previousVisibleCases = null;

  const updateActivityHighlight = () => {

    const nothingSelected = selectedActivities.size === 0;

    const highlightStart =
      select('#highlightStart').property('checked');

    const highlightEnd =
      select('#highlightEnd').property('checked');

    const noEventFilter = !highlightStart && !highlightEnd;

    // CONTROLEREN OF CASE VOLDOET AAN FILTERS

    const caseMatches = (d) => {

      const caseName = d.CASE_concept_name;

      const attributes = caseAttributes.get(caseName);

      if (!attributes) return false;

      // INITIAL FINE AMOUNT

      const amountMatches =
        Number.isFinite(attributes.initialAmount) &&
        attributes.initialAmount >= selectedMinAmount &&
        attributes.initialAmount <= selectedMaxAmount;

      // ARTICLE

      const articleMatches =
        selectedArticles.size === 0 ||
        selectedArticles.has(attributes.article);

      // CASE DURATION

      const duration = durationByCase.get(caseName);

      const durationMatches =
        Number.isFinite(duration) &&
        duration >= selectedMinDuration &&
        duration <= selectedMaxDuration;

      return (
        amountMatches &&
        articleMatches &&
        durationMatches
      );

    };

    // CONTROLEREN OF EVENT GEKLEURD MOET WORDEN

    const isHighlighted = (d) => {

      const activityMatches =
        nothingSelected ||
        selectedActivities.has(activityValue(d));

      const positionMatches =
        noEventFilter ||
        (highlightStart && startEvents.has(d)) ||
        (highlightEnd && endEvents.has(d));

      return (
        caseMatches(d) &&
        activityMatches &&
        positionMatches
      );

    };


    // COUNT CASES MATCHING CASE FILTERS

    const matchingCaseNames = new Set(
      data
        .filter(d => caseMatches(d))
        .map(d => d.CASE_concept_name)
    );

    // COUNT CASES WITH HIGHLIGHTED EVENTS

    const highlightedCaseNames = new Set(
      data
        .filter(d => isHighlighted(d))
        .map(d => d.CASE_concept_name)
    );

    // UPDATE KEY NUMBERS

    matchingCasesElement.textContent =
      matchingCaseNames.size;
    
    highlightedCasesElement.textContent =
      highlightedCaseNames.size;


    // SHOW ONLY MATCHING CASES

    const showOnlyFiltered =
  select('#showFilteredCases').property('checked');

// Keep the current sorting settings

const selectedSort =
  select('#sortSelect').property('value');

const selectedDirection =
  select('#sortDirection').property('value');

const sortedCases = sortCases(
  selectedSort,
  selectedDirection
);

// Find cases containing at least one selected activity

const activityCaseNames = new Set(
  data
    .filter(d =>
      nothingSelected ||
      selectedActivities.has(activityValue(d))
    )
    .map(d => d.CASE_concept_name)
);

// Combine case filters and activity selection

const visibleCases = showOnlyFiltered
  ? sortedCases.filter(caseName =>
      matchingCaseNames.has(caseName) &&
      activityCaseNames.has(caseName)
    )
  : sortedCases;

// Create a set for checking visibility

const visibleCaseNames = new Set(visibleCases);

    // Update Y scales

    yScale.domain(visibleCases);
    overviewYScale.domain(visibleCases);

    // Hide events belonging to excluded cases

    circles.style('display', d =>
      !showOnlyFiltered ||
      visibleCaseNames.has(d.CASE_concept_name)
        ? null
        : 'none'
    );

    overviewCircles.style('display', d =>
      !showOnlyFiltered ||
      visibleCaseNames.has(d.CASE_concept_name)
        ? null
        : 'none'
    );

    // Update overview positions

    overviewCircles.attr(
      'cy',
      d => {
        const y = overviewYScale(yValue(d));

        return y === undefined
          ? -10
          : y + overviewYScale.bandwidth() / 2;
      }
    );

    // Reset zoom when the visible case set changes

    const currentVisibleCases = visibleCases.join('\u0000');

    if (currentVisibleCases !== previousVisibleCases) {
      previousVisibleCases = currentVisibleCases;

      plotGroup.call(
        zoomBehavior.transform,
        d3.zoomIdentity
      );
    }


    // KLEUREN HOOFDVISUALISATIE

    circles.attr('fill', (d) => {

      return isHighlighted(d)
        ? colorScale(activityValue(d))
        : '#d3d3d3';

    });

    // KLEUREN NAVIGATIEVENSTER

    overviewCircles.attr('fill', (d) => {

      return isHighlighted(d)
        ? colorScale(activityValue(d))
        : '#d3d3d3';

    });

    // OORSPRONKELIJKE TEKENVOLGORDE HERSTELLEN

    circles.order();
    overviewCircles.order();

    // GESELECTEERDE EVENTS NAAR VOREN BRENGEN

    circles
      .filter((d) => isHighlighted(d))
      .raise();

    overviewCircles
      .filter((d) => isHighlighted(d))
      .raise();

    // ACTIVITY LEGEND BIJWERKEN

    legendItems
      .style('opacity', (activity) => {

        return nothingSelected ||
          selectedActivities.has(activity)
          ? 1
          : 0.3;

      });

    legendItems
      .style('font-weight', (activity) => {

        return !nothingSelected &&
          selectedActivities.has(activity)
          ? 'bold'
          : 'normal';

      });

  };
  // EINDE FUNCTIE (VOOR HIGHLIGHT ACTIVITEITEN)

  // meerdere activiteiten kunnen seelcteren
  legendItems.on('click', function(activity) {
    if (selectedActivities.has(activity)) {
      selectedActivities.delete(activity);
    } else {
      selectedActivities.add(activity);
    }
    updateActivityHighlight();
  });

  select('#resetActivities').on('click', function() {
    selectedActivities.clear();
    updateActivityHighlight();
  });

  select('#highlightStart').on('change', function() {
  updateActivityHighlight();
});

select('#highlightEnd').on('change', function() {
  updateActivityHighlight();
});

// TOGGLE FILTERED CASE VIEW

select('#showFilteredCases').on('change', function() {
  updateActivityHighlight();
});

// INITIALIZE KEY NUMBERS AN DHIGHLIGHTING

updateActivityHighlight();

  });




