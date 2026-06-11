// data.js — мок данных мониторинга
// Имена объектов и ТС взяты из реальных скриншотов (uploads/).
window.MOCK = (() => {
  const objects = [
    { id: 'ekb',    name: 'Екатеринбург',                                                short: 'Екатеринбург',  vehicles: 13, kip: 95, trips: 1496, lat: 56.84, lng: 60.61, polygon: 'M 80 90 L 220 70 L 290 140 L 260 230 L 130 240 L 60 170 Z' },
    { id: 'omsk',   name: 'Омск',                                                        short: 'Омск',          vehicles: 10, kip: 78, trips: 24,   lat: 54.99, lng: 73.37, polygon: 'M 70 80 L 200 60 L 270 130 L 230 220 L 100 230 L 50 160 Z' },
    { id: 'pyt',    name: 'Пыть-Ях',                                                     short: 'Пыть-Ях',       vehicles: 2,  kip: 63, trips: 0,    lat: 60.74, lng: 72.86, polygon: 'M 90 60 L 240 80 L 280 180 L 200 240 L 80 220 L 60 140 Z' },
    { id: 'amur',   name: 'СМУ Амурская область, мост ч/з р. Завитая',                    short: 'СМУ Амурская', vehicles: 4,  kip: 50, trips: 0,    lat: 50.81, lng: 128.46, polygon: 'M 60 100 L 200 80 L 300 150 L 280 230 L 140 240 L 60 180 Z' },
    { id: 'vsm',    name: 'СМУ ВСЖМ, 3 этап',                                            short: 'СМУ ВСЖМ',     vehicles: 18, kip: 42, trips: 0,    lat: 51.99, lng: 85.97, polygon: 'M 90 70 L 230 60 L 300 130 L 260 230 L 110 240 L 50 150 Z' },
    { id: 'bod',    name: 'Г. Бодайбо, карьер',                                          short: 'Бодайбо, карьер', vehicles: 9, kip: 90, trips: 1805, lat: 57.85, lng: 114.20, polygon: 'M 70 90 L 210 70 L 280 130 L 270 220 L 120 240 L 60 170 Z' },
    { id: 'belogor', name: 'СМУ г. Белогорск, стр-во А/Д путепровода ч/з Транссиб',     short: 'СМУ Белогорск', vehicles: 18, kip: 42, trips: 14074, lat: 50.92, lng: 128.47, polygon: 'M 80 100 L 220 80 L 290 150 L 250 220 L 130 230 L 60 160 Z' },
    { id: 'akiv',   name: 'Большие Акивы',                                              short: 'Большие Акивы', vehicles: 2,  kip: 84, trips: 109,  lat: 60.10, lng: 88.10, polygon: 'M 100 80 L 220 60 L 280 140 L 240 230 L 110 240 L 70 160 Z' },
  ];

  const vehicleTypes = [
    { id: 'samosvaly', label: 'Самосвалы',       color: '#F97316', icon: 'dump' },
    { id: 'kip',       label: 'КИП-техника',     color: '#60A5FA', icon: 'kip' },
    { id: 'ekskav',    label: 'Экскаваторы',     color: '#A78BFA', icon: 'excavator' },
    { id: 'krany',     label: 'Краны',           color: '#22C55E', icon: 'crane' },
  ];

  // Vehicles for the focused object (Belogorsk shown in screenshots)
  const vehicles = [
    { plate: 'P322TH196', type: 'samosvaly', model: 'HINO 600/Bell B40', org: 'МО-36', shifts: 23, kip: 93, idle: 3,  engineTotal: '257:36', trips24: 1, liters: 1272, comment: 'Слежка по месту' },
    { plate: 'K641YK196', type: 'samosvaly', model: 'HINO 700',          org: 'МО-36', shifts: 24, kip: 78, idle: 7,  engineTotal: '209:50', trips24: 0, liters: 1180 },
    { plate: 'P595M0186', type: 'samosvaly', model: 'SANY 8x4',          org: 'МО-36', shifts: 24, kip: 76, idle: 6,  engineTotal: '215:24', trips24: 0, liters: 1090 },
    { plate: 'E340EC138', type: 'samosvaly', model: 'SHACMAN 8x4',       org: 'МО-36', shifts: 23, kip: 87, idle: 33, engineTotal: '267:43', trips24: 0, liters: 940 },
    { plate: 'P431HT138', type: 'samosvaly', model: 'SHACMAN 8x4',       org: 'МО-36', shifts: 23, kip: 97, idle: 38, engineTotal: '267:18', trips24: 0, liters: 1340 },
    { plate: 'T724HM138', type: 'samosvaly', model: 'HINO 700',          org: 'МО-36', shifts: 22, kip: 58, idle: 12, engineTotal: '198:00', trips24: 0, liters: 880 },
    { plate: 'У393МЕ72',  type: 'ekskav',    model: 'Volvo EC480',       org: 'МО-36', shifts: 21, kip: 79, idle: 21, engineTotal: '197:14', trips24: 0, liters: 320, comment: '99% КИП за 8 дней' },
    { plate: '00890К72',  type: 'ekskav',    model: 'Эксковатор гусеничный', org: 'МО-36', shifts: 24, kip: 67, idle: 87, engineTotal: '177:09', trips24: 0, liters: 2459 },
    { plate: '69610E72',  type: 'ekskav',    model: 'Эксковатор гусеничный Caterpillar 329CL', org: 'МО-36', shifts: 24, kip: 97, idle: 90, engineTotal: '74:19', trips24: 2, liters: 1272 },
    { plate: 'A111KP66',  type: 'kip',       model: 'JCB 4CX',            org: 'НПС',   shifts: 18, kip: 84, idle: 18, engineTotal: '142:10', trips24: 0, liters: 220 },
    { plate: 'B250HE66',  type: 'kip',       model: 'Komatsu PC200',      org: 'НПС',   shifts: 20, kip: 65, idle: 24, engineTotal: '160:55', trips24: 0, liters: 410 },
    { plate: 'C708OO66',  type: 'krany',     model: 'Liebherr LTM 1090', org: 'НПС',   shifts: 14, kip: 48, idle: 10, engineTotal: '78:20',  trips24: 0, liters: 90 },
  ];

  // Build per-day shift chips for the focused vehicle
  function chips(plate) {
    const days = ['30.04','01.05','02.05','03.05','04.05','05.05','06.05','07.05','08.05','09.05','10.05','11.05','12.05'];
    return days.flatMap(d => ([
      { date: d, shift: 1, trips: Math.random() > .25 ? Math.floor(2 + Math.random()*16) : 0, kip: Math.floor(40 + Math.random()*60) },
      { date: d, shift: 2, trips: Math.random() > .25 ? Math.floor(2 + Math.random()*16) : 0, kip: Math.floor(40 + Math.random()*60) },
    ]));
  }
  vehicles.forEach(v => v.chips = chips(v.plate));

  return { objects, vehicleTypes, vehicles };
})();
