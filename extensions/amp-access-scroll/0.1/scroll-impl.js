/**
 * Copyright 2018 The AMP HTML Authors. All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *      http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS-IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import { AccessClientAdapter } from '../../amp-access/0.1/amp-access-client';
import { CSS } from '../../../build/amp-access-scroll-0.1.css';
import { ReadDepthTracker } from './read-depth-tracker.js';
import { Services } from '../../../src/services';
import { createElementWithAttributes } from '../../../src/dom';
import { dict } from '../../../src/utils/object';
import { getMode } from '../../../src/mode';
import { installStylesForDoc } from '../../../src/style-installer';
import { parseQueryString } from '../../../src/url';
import { listen } from '../../../src/3p-frame-messaging';

const TAG = 'amp-access-scroll-elt';

/**
 * @param {string} connectHostname
 * @return {!JsonObject}
 */
const accessConfig = connectHostname => {
  /** @const {!JsonObject} */
  const ACCESS_CONFIG = /** @type {!JsonObject} */ ({
    'authorization':
      `${connectHostname}/amp/access` +
      '?rid=READER_ID' +
      '&cid=CLIENT_ID(scroll1)' +
      '&c=CANONICAL_URL' +
      '&o=AMPDOC_URL' +
      '&x=QUERY_PARAM(scrollx)',
    'pingback':
      `${connectHostname}/amp/pingback` +
      '?rid=READER_ID' +
      '&cid=CLIENT_ID(scroll1)' +
      '&c=CANONICAL_URL' +
      '&o=AMPDOC_URL' +
      '&r=DOCUMENT_REFERRER' +
      '&x=QUERY_PARAM(scrollx)' +
      '&d=AUTHDATA(scroll)' +
      '&v=AUTHDATA(visitId)',
    'namespace': 'scroll',
  });
  return ACCESS_CONFIG;
};

/**
 * @param {string} connectHostname
 * @return {!JsonObject}
 */
const analyticsConfig = connectHostname => {
  const ANALYTICS_CONFIG = /** @type {!JsonObject} */ ({
    'requests': {
      'scroll':
        `${connectHostname}/amp/analytics` +
        '?rid=ACCESS_READER_ID' +
        '&cid=CLIENT_ID(scroll1)' +
        '&c=CANONICAL_URL' +
        '&o=AMPDOC_URL' +
        '&r=DOCUMENT_REFERRER' +
        '&x=QUERY_PARAM(scrollx)' +
        '&d=AUTHDATA(scroll.scroll)' +
        '&v=AUTHDATA(scroll.visitId)' +
        '&h=SOURCE_HOSTNAME' +
        '&s=${totalEngagedTime}',
    },
    'triggers': {
      'trackInterval': {
        'on': 'timer',
        'timerSpec': {
          'interval': 15,
          'maxTimerLength': 7200,
        },
        'request': 'scroll',
      },
    },
  });
  return ANALYTICS_CONFIG;
};

/**
 * The eTLD for scroll URLs in development mode.
 *
 * Enables amp-access-scroll to work with dev/staging environments.
 *
 * @param {!JsonObject} config
 * @return {string}
 */
const devEtld = config => {
  return getMode().development && config['etld'] ? config['etld'] : '';
};

/**
 * The connect server hostname.
 *
 * @param {!JsonObject} config
 * @return {string}
 */
const connectHostname = config => {
  return `https://connect${devEtld(config) || '.scroll.com'}`;
};

/**
 * amp-access vendor that authenticates against the scroll.com service.
 * If the user is authenticated, also adds a fixed position iframe
 * to the page.
 *
 * A little gross, but avoid some duplicate code by inheriting
 * from ClientAdapter.
 * @implements {../../amp-access/0.1/access-vendor.AccessVendor}
 */
export class ScrollAccessVendor extends AccessClientAdapter {
  /**
   * @param {!../../../src/service/ampdoc-impl.AmpDoc} ampdoc
   * @param {!../../amp-access/0.1/amp-access-source.AccessSource} accessSource
   */
  constructor(ampdoc, accessSource) {
    const scrollConfig = accessSource.getAdapterConfig();
    super(ampdoc, accessConfig(connectHostname(scrollConfig)), {
      buildUrl: accessSource.buildUrl.bind(accessSource),
      collectUrlVars: accessSource.collectUrlVars.bind(accessSource),
    });

    /** @private {!../../amp-access/0.1/amp-access-source.AccessSource} */
    this.accessSource_ = accessSource;
    this.frames_ = [];
  }

  /** @override */
  authorize() {
    // TODO(dbow): Handle timeout?
    return super.authorize().then(response => {
      const isStory = this.ampdoc
        .getRootNode()
        .querySelector('amp-story[standalone]');
      if (response && response['scroll']) {
        if (!isStory) {
          const config = this.accessSource_.getAdapterConfig();



          const scrollbar = new ScrollElement(this.ampdoc);
          scrollbar.handleScrollUser(
            this.accessSource_,
            config
          );
          this.frames_.push(scrollbar.getContentWindow());
          let state = 0;
          listen(window, 'message', (e) => {
            if (e.source !== window) {
              console.log(this.frames_.indexOf(e.source), e, this.frames_);
            }
            if (this.frames_.indexOf(e.source) > -1) {
              console.log(
                Date.now() / 1000,
                window.location.host,
                '<',
                e.origin,
                state,
                e.data
              );

              if ('_s_ap' in e.data) {
                if (e.data._s_ap) {
                  const i = Audio.instance(config, this.ampdoc);
                  i.showAudio(e.data.url);
                  this.frames_.push(i._iframe.contentWindow);
                } else {
                  Audio.instance(config, this.ampdoc).hideAudio();
                }

              }

              // if (state === 0 && e.data._scrmp === "_ps_rs_ha") {
              //   // echo handshake
              //   e.source.postMessage(e.data, '*');
              //   state++;
              // } else if (state === 1 && e.data._scrmp === '_ps_rs') {
              //   e.source.postMessage({ _scrmp: "_ps_rs", _scrmd: "{}" }, '*');
              //   state++;
              // }
            }
          })



          // this.frames_.push(scrollbar.getContentWindow());
          addAnalytics(this.ampdoc, config);
          if (response['features'] && response['features']['readDepth']) {
            new ReadDepthTracker(
              this.ampdoc,
              this.accessSource_,
              connectHostname(config)
            );
          }
        }
      } else {
        if (
          response &&
          response['blocker'] &&
          ScrollContentBlocker.shouldCheck(this.ampdoc)
        ) {
          new ScrollContentBlocker(this.ampdoc, this.accessSource_).check();
        }
      }
      return response;
    });
  }
}

class Audio {
  constructor(config, ampdoc) {
    this.config = config
    this.makeIframe(ampdoc)
  }

  static instance(config, ampdoc) {
    if (!Audio._i) { Audio._i = new Audio(config, ampdoc) }
    return Audio._i;
  }

  /** Show audio iframe. */
  showAudio(url) {
    this._iframe.setAttribute('src', url)
    this._iframe.style.display = 'block';
  }

  hideAudio() {
    this._iframe.style.display = 'none';
  }

  /* @private */
  makeIframe(ampdoc) {
    /** @const {!Element} */
    const iframe_ = document.createElement('iframe');
    iframe_.setAttribute('class', 'amp-access-scroll-audio')
    iframe_.setAttribute('scrolling', 'no');
    iframe_.setAttribute('frameborder', '0');
    iframe_.setAttribute('allowtransparency', 'true');
    iframe_.setAttribute('title', 'Scroll Audio');
    iframe_.setAttribute(
      'sandbox',
      'allow-scripts allow-same-origin ' +
      'allow-top-navigation allow-popups ' +
      'allow-popups-to-escape-sandbox'
    );
    ampdoc.getBody().appendChild(iframe_);
    this._iframe = iframe_;

    // Promote to fixed layer.
    Services.viewportForDoc(ampdoc).addToFixedLayer(iframe_);
  }


}


/**
 * Coordinate with the Scroll App's Content Blocker on Safari browsers.
 */
class ScrollContentBlocker {
  /**
   * @param {!../../../src/service/ampdoc-impl.AmpDoc} ampdoc
   * @return {boolean}
   * @static
   */
  static shouldCheck(ampdoc) {
    const queryParams = parseQueryString(ampdoc.win.location.search);
    return !queryParams['scrollnoblockerrefresh'];
  }

  /**
   * @param {!../../../src/service/ampdoc-impl.AmpDoc} ampdoc
   * @param {!../../amp-access/0.1/amp-access-source.AccessSource} accessSource
   */
  constructor(ampdoc, accessSource) {
    /** @const @private {!../../../src/service/ampdoc-impl.AmpDoc} */
    this.ampdoc_ = ampdoc;

    /** @const @private {!../../amp-access/0.1/amp-access-source.AccessSource} */
    this.accessSource_ = accessSource;
  }

  /**
   * Check if the Scroll App blocks the resource request.
   */
  check() {
    Services.xhrFor(this.ampdoc_.win)
      .fetchJson('https://block.scroll.com/check.json')
      .then(() => false, e => this.blockedByScrollApp_(e.message))
      .then(blockedByScrollApp => {
        if (blockedByScrollApp === true) {
          // TODO(dbow): Ideally we would automatically redirect to the page
          // here, but for now we are adding a button so we redirect on user
          // action.
          new ScrollElement(this.ampdoc_).addActivateButton(
            this.accessSource_,
            this.accessSource_.getAdapterConfig()
          );
        }
      });
  }

  /**
   * Whether the given error message indicates the Scroll App blocked the
   * request.
   *
   * @param {string} message
   * @return {boolean}
   * @private
   */
  blockedByScrollApp_(message) {
    return (
      message.indexOf(
        'XHR Failed fetching (https://block.scroll.com/...): ' +
        'Resource blocked by content blocker'
      ) === 0
    );
  }
}

/**
 * UI for Scroll users.
 *
 * Presents a fixed bar at the bottom of the screen with Scroll content.
 */
class ScrollElement {
  /**
   * @param {!../../../src/service/ampdoc-impl.AmpDoc} ampdoc
   */
  constructor(ampdoc) {
    installStylesForDoc(ampdoc, CSS, () => { }, false, TAG);

    /** @const {!../../../src/service/ampdoc-impl.AmpDoc} */
    this.ampdoc_ = ampdoc;

    /** @const {!Element} */
    this.scrollBar_ = document.createElement('div');
    this.scrollBar_.classList.add('amp-access-scroll-bar');

    /** @const {!Element} */
    this.iframe_ = document.createElement('iframe');
    this.iframe_.setAttribute('scrolling', 'no');
    this.iframe_.setAttribute('frameborder', '0');
    this.iframe_.setAttribute('allowtransparency', 'true');
    this.iframe_.setAttribute('title', 'Scroll');
    this.iframe_.setAttribute('width', '100%');
    this.iframe_.setAttribute('height', '100%');
    this.iframe_.setAttribute(
      'sandbox',
      'allow-scripts allow-same-origin ' +
      'allow-top-navigation allow-popups ' +
      'allow-popups-to-escape-sandbox'
    );

    this.scrollBar_.appendChild(this.iframe_);
    ampdoc.getBody().appendChild(this.scrollBar_);

    // Promote to fixed layer.
    Services.viewportForDoc(ampdoc).addToFixedLayer(this.scrollBar_);
  }

  /** @return {Window} */
  getContentWindow() {
    return this.iframe_.contentWindow;
  }

  /**
   * Add a scrollbar placeholder and then load the scrollbar URL in the iframe.
   *
   * @param {!../../amp-access/0.1/amp-access-source.AccessSource} accessSource
   * @param {!JsonObject} vendorConfig
   */
  handleScrollUser(accessSource, vendorConfig) {
    // Add a placeholder element to display while scrollbar iframe loads.
    const placeholder = document.createElement('div');
    placeholder.classList.add('amp-access-scroll-bar');
    placeholder.classList.add('amp-access-scroll-placeholder');
    const img = document.createElement('img');
    img.setAttribute(
      'src',
      'https://static.scroll.com/assets/icn-scroll-logo32-9f4ceef399905139bbd26b87bfe94542.svg'
    );
    img.setAttribute('layout', 'fixed');
    img.setAttribute('width', 32);
    img.setAttribute('height', 32);
    placeholder.appendChild(img);
    this.ampdoc_.getBody().appendChild(placeholder);

    // Set iframe to scrollbar URL.
    accessSource
      .buildUrl(
        `${connectHostname(vendorConfig)}/amp/scrollbar` +
        '?rid=READER_ID' +
        '&cid=CLIENT_ID(scroll1)' +
        '&c=CANONICAL_URL' +
        '&o=AMPDOC_URL',
        false
      )
      .then(scrollbarUrl => {
        this.iframe_.onload = () => {
          // On iframe load, remove placeholder element.
          this.ampdoc_.getBody().removeChild(placeholder);
        };
        this.iframe_.setAttribute('src', scrollbarUrl);
      });
  }

  /**
   * Add link to the Scroll App connect page.
   *
   * @param {!../../amp-access/0.1/amp-access-source.AccessSource} accessSource
   * @param {!JsonObject} vendorConfig
   */
  addActivateButton(accessSource, vendorConfig) {
    accessSource
      .buildUrl(
        `${connectHostname(vendorConfig)}/html/amp/activate` +
        '?rid=READER_ID' +
        '&cid=CLIENT_ID(scroll1)' +
        '&c=CANONICAL_URL' +
        '&o=AMPDOC_URL' +
        '&x=QUERY_PARAM(scrollx)',
        false
      )
      .then(url => {
        this.iframe_.setAttribute('src', url);
      });
  }
}

/**
 * Add analytics for Scroll to page.
 * @param {!../../../src/service/ampdoc-impl.AmpDoc} ampdoc
 * @param {!JsonObject} vendorConfig
 */
function addAnalytics(ampdoc, vendorConfig) {
  if (vendorConfig['disableAnalytics']) {
    return;
  }

  // Create analytics element
  const doc = /** @type {!Document} */ (ampdoc.win.document);
  const attributes = dict({ 'trigger': 'immediate' });
  if (vendorConfig['dataConsentId']) {
    attributes['data-block-on-consent'] = '';
  }
  const analyticsElem = createElementWithAttributes(
    doc,
    'amp-analytics',
    attributes
  );
  const scriptElem = createElementWithAttributes(
    doc,
    'script',
    dict({
      'type': 'application/json',
    })
  );
  const ANALYTICS_CONFIG = analyticsConfig(connectHostname(vendorConfig));
  scriptElem.textContent = JSON.stringify(ANALYTICS_CONFIG);
  analyticsElem.appendChild(scriptElem);
  analyticsElem.CONFIG = ANALYTICS_CONFIG;

  // Get extensions service and force load analytics extension
  const extensions = Services.extensionsFor(ampdoc.win);
  extensions./*OK*/ installExtensionForDoc(ampdoc, 'amp-analytics');

  // Append
  ampdoc.getBody().appendChild(analyticsElem);
}
