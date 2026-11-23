// On-screen controls in the device's language (menus and messages are English for now).
const T = {
  en: { gas: 'GAS', brake: 'BRAKE<br>/ REV', hand: 'Handbrake', recentre: 'Re-centre', wake: '📱 Tap to turn on tilt steering', guess: 'Guess', help: 'Help', trip: { bus: 'Take a bus', train: 'Take a train', ferry: 'Take a ferry', plane: 'Take a plane' } },
  fr: { gas: 'GAZ', brake: 'FREIN<br>/ ARR.', hand: 'Frein à main', recentre: 'Recentrer', wake: '📱 Touchez pour activer l\'inclinaison', guess: 'Deviner', help: 'Aide', trip: { bus: 'Prendre le bus', train: 'Prendre le train', ferry: 'Prendre le ferry', plane: 'Prendre l\'avion' } },
  de: { gas: 'GAS', brake: 'BREMSE<br>/ RÜCKW.', hand: 'Handbremse', recentre: 'Zentrieren', wake: '📱 Tippen für Neigungslenkung', guess: 'Raten', help: 'Hilfe', trip: { bus: 'Bus nehmen', train: 'Zug nehmen', ferry: 'Fähre nehmen', plane: 'Flugzeug nehmen' } },
  es: { gas: 'ACELERAR', brake: 'FRENO<br>/ ATRÁS', hand: 'Freno de mano', recentre: 'Centrar', wake: '📱 Toca para activar la inclinación', guess: 'Adivinar', help: 'Ayuda', trip: { bus: 'Tomar el bus', train: 'Tomar el tren', ferry: 'Tomar el ferry', plane: 'Tomar un avión' } },
  it: { gas: 'GAS', brake: 'FRENO<br>/ RETRO', hand: 'Freno a mano', recentre: 'Centra', wake: '📱 Tocca per lo sterzo a inclinazione', guess: 'Indovina', help: 'Aiuto', trip: { bus: 'Prendi il bus', train: 'Prendi il treno', ferry: 'Prendi il traghetto', plane: 'Prendi l\'aereo' } },
  pt: { gas: 'ACELERAR', brake: 'TRAVÃO<br>/ RÉ', hand: 'Travão de mão', recentre: 'Centrar', wake: '📱 Toque para ligar a inclinação', guess: 'Adivinhar', help: 'Ajuda', trip: { bus: 'Apanhar o autocarro', train: 'Apanhar o comboio', ferry: 'Apanhar o ferry', plane: 'Apanhar o avião' } },
  'pt-BR': { gas: 'ACELERAR', brake: 'FREIO<br>/ RÉ', hand: 'Freio de mão', recentre: 'Centralizar', wake: '📱 Toque para ligar a inclinação', guess: 'Adivinhar', help: 'Ajuda', trip: { bus: 'Pegar o ônibus', train: 'Pegar o trem', ferry: 'Pegar a balsa', plane: 'Pegar o avião' } },
  nl: { gas: 'GAS', brake: 'REM<br>/ ACHTERUIT', hand: 'Handrem', recentre: 'Centreren', wake: '📱 Tik om kantelsturen aan te zetten', guess: 'Raden', help: 'Hulp', trip: { bus: 'Neem de bus', train: 'Neem de trein', ferry: 'Neem de veerboot', plane: 'Neem het vliegtuig' } },
  sv: { gas: 'GAS', brake: 'BROMS<br>/ BACK', hand: 'Handbroms', recentre: 'Centrera', wake: '📱 Tryck för lutstyrning', guess: 'Gissa', help: 'Hjälp', trip: { bus: 'Ta bussen', train: 'Ta tåget', ferry: 'Ta färjan', plane: 'Ta flyget' } },
  da: { gas: 'SPEEDER', brake: 'BREMSE<br>/ BAK', hand: 'Håndbremse', recentre: 'Centrer', wake: '📱 Tryk for vippestyring', guess: 'Gæt', help: 'Hjælp', trip: { bus: 'Tag bussen', train: 'Tag toget', ferry: 'Tag færgen', plane: 'Tag flyet' } },
  nb: { gas: 'GASS', brake: 'BREMS<br>/ REVERS', hand: 'Håndbrekk', recentre: 'Sentrer', wake: '📱 Trykk for vippestyring', guess: 'Gjett', help: 'Hjelp', trip: { bus: 'Ta bussen', train: 'Ta toget', ferry: 'Ta ferja', plane: 'Ta fly' } },
  pl: { gas: 'GAZ', brake: 'HAMULEC<br>/ WSTECZ', hand: 'Ręczny', recentre: 'Wyśrodkuj', wake: '📱 Dotknij, by włączyć przechył', guess: 'Zgadnij', help: 'Pomoc', trip: { bus: 'Jedź autobusem', train: 'Jedź pociągiem', ferry: 'Płyń promem', plane: 'Leć samolotem' } },
  tr: { gas: 'GAZ', brake: 'FREN<br>/ GERİ', hand: 'El freni', recentre: 'Ortala', wake: '📱 Eğim direksiyonu için dokun', guess: 'Tahmin', help: 'Yardım', trip: { bus: 'Otobüse bin', train: 'Trene bin', ferry: 'Feribota bin', plane: 'Uçağa bin' } },
  ru: { gas: 'ГАЗ', brake: 'ТОРМОЗ<br>/ НАЗАД', hand: 'Ручник', recentre: 'По центру', wake: '📱 Нажмите, чтобы включить наклон', guess: 'Угадать', help: 'Помощь', trip: { bus: 'Сесть в автобус', train: 'Сесть на поезд', ferry: 'Сесть на паром', plane: 'Полететь' } },
  ja: { gas: 'アクセル', brake: 'ブレーキ<br>/ バック', hand: 'サイド', recentre: '中央に戻す', wake: '📱 タップして傾きハンドルをオン', guess: '当てる', help: 'ヘルプ', trip: { bus: 'バスに乗る', train: '電車に乗る', ferry: 'フェリーに乗る', plane: '飛行機に乗る' } },
  ko: { gas: '가속', brake: '브레이크<br>/ 후진', hand: '사이드', recentre: '중앙 맞추기', wake: '📱 탭하여 기울기 조향 켜기', guess: '맞히기', help: '도움말', trip: { bus: '버스 타기', train: '기차 타기', ferry: '페리 타기', plane: '비행기 타기' } },
  zh: { gas: '油门', brake: '刹车<br>/ 倒车', hand: '手刹', recentre: '回中', wake: '📱 点按开启倾斜转向', guess: '猜一猜', help: '帮助', trip: { bus: '乘公交', train: '乘火车', ferry: '乘渡轮', plane: '乘飞机' } },
};
const lang = (navigator.language || 'en').toLowerCase();
const pick = T[lang === 'pt-br' ? 'pt-BR' : lang.split('-')[0] === 'no' || lang.startsWith('nn') ? 'nb' : lang.split('-')[0]] || T.en;
export const L = { ...T.en, ...pick, trip: { ...T.en.trip, ...pick.trip } };
export const isEnglish = pick === T.en;
