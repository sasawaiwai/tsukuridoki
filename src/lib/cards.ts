// ページでカードを作るための共通処理（ビルド時に使用）

import { loadSiteData } from './data.ts';
import { processMap, toCardModel, type CardModel } from './fair-display.ts';
import type { DateString, Fair, SiteData } from './types.ts';

export function cardBuilder(today: DateString): { data: SiteData; toCard: (fair: Fair) => CardModel } {
  const data = loadSiteData();
  const processes = processMap(data.processes);
  const printerName = new Map(data.printers.map((p) => [p.printer_id, p.name]));
  return {
    data,
    toCard: (fair) =>
      toCardModel(fair, { printerName: printerName.get(fair.printer_id) ?? fair.printer_id, processes, today }),
  };
}
