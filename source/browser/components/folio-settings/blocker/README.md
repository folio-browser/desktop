# Folio blocker data

`ublock-scriptlets.json`: uBlock Origin 1.77.0's MAIN-world scriptlets (js/resources/scriptlets.js in the uBlock
xpi Folio ships), converted to adblock-rust's Resource JSON by `convert-ublock-scriptlets.mjs`. uBlock Origin is
GPLv3 (https://github.com/gorhill/uBlock); this file is uBlock's code carried as data for Folio's native filter
engine, the same way Folio already ships the uBlock xpi itself. Regenerate when the bundled uBlock is updated:

    unzip uBlock0@raymondhill.net.xpi 'js/*' -d ub && echo '{"type":"module"}' > ub/js/package.json
    node convert-ublock-scriptlets.mjs ub/js/resources ublock-scriptlets.json
