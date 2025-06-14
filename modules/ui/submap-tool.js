"use strict";

function openSubmapTool() {
  resetInputs();

  $("#submapTool").dialog({
    title: "Create a submap",
    resizable: false,
    width: "32em",
    position: {my: "center", at: "center", of: "svg"},
    buttons: {
      Seleccionar_Area_Manualmente: function() {
      enableManualAreaSelection();
      $(this).dialog("close");
    },
      Submap: function () {
        closeDialogs();
        generateSubmap();
      },
      Cancel: function () {
        $(this).dialog("close");
      }
    }
  });

  if (modules.openSubmapTool) return;
  modules.openSubmapTool = true;

  function resetInputs() {
    updateCellsNumber(byId("pointsInput").value);
    byId("submapPointsInput").oninput = e => updateCellsNumber(e.target.value);

    function updateCellsNumber(value) {
      byId("submapPointsInput").value = value;
      const cells = cellsDensityMap[value];
      byId("submapPointsInput").dataset.cells = cells;
      const output = byId("submapPointsFormatted");
      output.value = cells / 1000 + "K";
      output.style.color = getCellsDensityColor(cells);
    }
  }

  function generateSubmap() {
    INFO && console.group("generateSubmap");

    const [x0, y0] = [Math.abs(viewX / scale), Math.abs(viewY / scale)]; // top-left corner
    recalculateMapSize(x0, y0);

    const submapPointsValue = byId("submapPointsInput").value;
    const globalPointsValue = byId("pointsInput").value;
    if (submapPointsValue !== globalPointsValue) changeCellsDensity(submapPointsValue);

    const projection = (x, y) => [(x - x0) * scale, (y - y0) * scale];
    const inverse = (x, y) => [x / scale + x0, y / scale + y0];

    applyGraphSize();
    fitMapToScreen();
    resetZoom(0);
    undraw();
    Resample.process({projection, inverse, scale});

    if (byId("submapRescaleBurgStyles").checked) rescaleBurgStyles(scale);
    drawLayers();

    INFO && console.groupEnd("generateSubmap");
  }

  function recalculateMapSize(x0, y0) {
    const mapSize = +byId("mapSizeOutput").value;
    byId("mapSizeOutput").value = byId("mapSizeInput").value = rn(mapSize / scale, 2);

    const latT = mapCoordinates.latT / scale;
    const latN = getLatitude(y0);
    const latShift = (90 - latN) / (180 - latT);
    byId("latitudeOutput").value = byId("latitudeInput").value = rn(latShift * 100, 2);

    const lotT = mapCoordinates.lonT / scale;
    const lonE = getLongitude(x0 + graphWidth / scale);
    const lonShift = (180 - lonE) / (360 - lotT);
    byId("longitudeOutput").value = byId("longitudeInput").value = rn(lonShift * 100, 2);

    distanceScale = distanceScaleInput.value = rn(distanceScale / scale, 2);
    populationRate = populationRateInput.value = rn(populationRate / scale, 2);
  }

  function rescaleBurgStyles(scale) {
    const burgIcons = [...byId("burgIcons").querySelectorAll("g")];
    for (const group of burgIcons) {
      const newRadius = rn(minmax(group.getAttribute("size") * scale, 0.2, 10), 2);
      changeRadius(newRadius, group.id);
      const strokeWidth = group.attributes["stroke-width"];
      strokeWidth.value = strokeWidth.value * scale;
    }

    const burgLabels = [...byId("burgLabels").querySelectorAll("g")];
    for (const group of burgLabels) {
      const size = +group.dataset.size;
      group.dataset.size = Math.max(rn((size + size / scale) / 2, 2), 1) * scale;
    }
  }
}

let selectingArea = false;
let start = null, end = null;
let selectionRect = null;

function enableManualAreaSelection() {
  selectingArea = true;
  mapSvg.style.cursor = "crosshair";

  mapSvg.addEventListener("mousedown", startSelection);
  mapSvg.addEventListener("mousemove", drawSelection);
  mapSvg.addEventListener("mouseup", finishSelection);
}

function startSelection(e) {
  if (!selectingArea) return;
  start = getMapCoordinates(e);
  if (selectionRect) selectionRect.remove();
  selectionRect = document.createElementNS("http://www.w3.org/2000/svg", "rect");
  selectionRect.setAttribute("fill", "rgba(0, 0, 255, 0.2)");
  selectionRect.setAttribute("stroke", "blue");
  selectionRect.setAttribute("stroke-dasharray", "4");
  mapSvg.appendChild(selectionRect);
}

function drawSelection(e) {
  if (!selectingArea || !start) return;
  end = getMapCoordinates(e);
  const x = Math.min(start.x, end.x);
  const y = Math.min(start.y, end.y);
  const width = Math.abs(start.x - end.x);
  const height = Math.abs(start.y - end.y);
  selectionRect.setAttribute("x", x);
  selectionRect.setAttribute("y", y);
  selectionRect.setAttribute("width", width);
  selectionRect.setAttribute("height", height);
}

function finishSelection(e) {
  if (!selectingArea) return;
  end = getMapCoordinates(e);
  selectingArea = false;
  mapSvg.style.cursor = "";
  // Ahora tienes start y end, pásalos a generateSubmap o guarda para su uso
  mapSvg.removeEventListener("mousedown", startSelection);
  mapSvg.removeEventListener("mousemove", drawSelection);
  mapSvg.removeEventListener("mouseup", finishSelection);
  // Llama a generateSubmap con las coordenadas seleccionadas
  generateSubmapWithArea(start, end);
}
function generateSubmapWithArea(start, end) {
  INFO && console.group("generateSubmapWithArea");

  // 1. Calcula el área seleccionada
  const x0 = Math.min(start.x, end.x);
  const y0 = Math.min(start.y, end.y);
  const x1 = Math.max(start.x, end.x);
  const y1 = Math.max(start.y, end.y);

  // 2. Ajusta la vista y el tamaño SVG al área seleccionada
  viewX = -x0 * scale;
  viewY = -y0 * scale;
  svgWidth = (x1 - x0) * scale;
  svgHeight = (y1 - y0) * scale;

  // 3. Recalcula el tamaño del mapa y otros parámetros
  recalculateMapSize(x0, y0);

  const submapPointsValue = byId("submapPointsInput").value;
  const globalPointsValue = byId("pointsInput").value;
  if (submapPointsValue !== globalPointsValue) changeCellsDensity(submapPointsValue);

  // 4. Define las proyecciones para el recorte de submapa
  const projection = (x, y) => [(x - x0) * scale, (y - y0) * scale];
  const inverse = (x, y) => [x / scale + x0, y / scale + y0];

  applyGraphSize();
  fitMapToScreen();
  resetZoom(0);
  undraw();
  Resample.process({projection, inverse, scale});

  if (byId("submapRescaleBurgStyles").checked) rescaleBurgStyles(scale);
  drawLayers();

  INFO && console.groupEnd("generateSubmapWithArea");
}
