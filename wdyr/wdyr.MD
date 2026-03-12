# Kullanım

## Kullanmadan önce aşağıdaki satırlar aktif edilmeli

- babel.config.js 
```js
{
  jsxImportSource: "@welldone-softwarewhy-did-you-render"
}
```

- index.js
```js
import './wdyr/wdyr.js'
```

## wdyr.js

```js
whyDidYouRender(React, {
  include: [/.*/g],
  // logOnDifferentValues: true,
  notifier,
  // trackAllPureComponents: true
});
```

- console'a output için notifier verilmemeli
- api'ye output için notifier-api.js (ayrıca api de çalıştırılmalı. [api reposu](https://gitlab.com/roket_pay/mobile/react-render-monitor)

```js
const notifier = require("./notifier-api.js").createDefaultNotifier(1000, whyDidYouRender.wdyrStore)
```

- normalde sadece proplar değişince raporlanmıyor ama logOnDifferentValues: true ile proplar değişmediği ama parent render olduğu için render olunan durumda da raporlanıyor
- raporlamayı sadece spesifik bir componentta aktif etmek için configi kullanınca beklenmedik sonuçlar alınabiliyor. Onun yerine notifier-api.js içerisinde defualtNotifier içine aşağıdaki gibi logicler eklemek daha iyi oluyor.

```js
if (displayName !== "SvgComponent" || displayName !== "VisibilitySensor") return;
```

- veya çok fazla render olan bir component olursa ignorelamak için 
```js
if (displayName === "SvgComponent" || displayName === "VisibilitySensor") return;
```
