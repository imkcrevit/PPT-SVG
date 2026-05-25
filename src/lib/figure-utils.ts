import type { Figure, FigureElement } from "@/lib/types";

export function cloneFigure(figure: Figure): Figure {
  return JSON.parse(JSON.stringify(figure)) as Figure;
}

export function findElement(elements: FigureElement[], id: string): FigureElement | undefined {
  for (const element of elements) {
    if (element.id === id) {
      return element;
    }

    if (element.type === "group") {
      const child = findElement(element.children, id);
      if (child) {
        return child;
      }
    }
  }

  return undefined;
}

export function updateElement(
  elements: FigureElement[],
  id: string,
  updater: (element: FigureElement) => FigureElement
): FigureElement[] {
  return elements.map((element) => {
    if (element.id === id) {
      return updater(element);
    }

    if (element.type === "group") {
      return {
        ...element,
        children: updateElement(element.children, id, updater)
      };
    }

    return element;
  });
}

