/**
 * Copyright 2016 The AMP HTML Authors. All Rights Reserved.
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

import {Messaging, WindowPortEmulator} from './messaging.js';
import {viewerForDoc} from '../../../src/viewer';
import {listen, listenOnce} from '../../../src/event-helper';
import {dev} from '../../../src/log';
import {isIframed} from '../../../src/dom';

const TAG = 'amp-viewer-integration';
const APP = '__AMPHTML__';

/**
 * @enum {string}
 */
const RequestNames = {
  CHANNEL_OPEN: 'channelOpen',
  UNLOADED: 'unloaded',
};

/**
 * @fileoverview This is the communication protocol between AMP and the viewer.
 * This should be included in an AMP html file to communicate with the viewer.
 */
export class AmpViewerIntegration {

  /**
   * @param {!Window} win
   */
  constructor(win) {
    /** @const {!Window} win */
    this.win = win;

    /** @private {?string|undefined} */
    this.unconfirmedViewerOrigin_ = null;

    /** @private {boolean} */
    this.isWebView_ = false;
  }

  /**
   * Initiate the handshake. If handshake confirmed, start listening for
   * messages. The service is disabled if the viewerorigin parameter is
   * absent.
   * @return {!Promise<undefined>}
   */
  init() {
    dev().fine(TAG, 'handshake init()');
    const viewer = viewerForDoc(this.win.document);
    this.isWebView_ = viewer.getParam('webview') == '1';
    this.unconfirmedViewerOrigin_ = viewer.getParam('origin');

    if (!this.isWebView_ && !this.unconfirmedViewerOrigin_) {
      return Promise.resolve();
    }

    if (this.isWebView_) {
      let source;
      let origin;
      if (isIframed(this.win)) {
        source = this.win.parent;
        origin = dev().assertString(this.unconfirmedViewerOrigin_);
      } else {
        source = null;
        origin = '';
      }
      return this.webviewPreHandshakePromise_(source, origin)
          .then(receivedPort => {
            return this.openChannelAndStart_(viewer, receivedPort);
          });
    }

    const port = new WindowPortEmulator(
      this.win, dev().assertString(this.unconfirmedViewerOrigin_));
    return this.openChannelAndStart_(viewer, port);
  }

  /**
   * @param {?Window} source
   * @param {string} origin
   * @return {!Promise}
   * @private
   */
  webviewPreHandshakePromise_(source, origin) {
    return new Promise(resolve => {
      const unlisten = listen(this.win, 'message', e => {
        dev().fine(TAG, 'AMPDOC got a pre-handshake message:', e.type, e.data);
        // Viewer says: "I'm ready for you"
        if (
            e.origin === origin &&
            e.source === source &&
            e.data.app == APP &&
            e.data.name == 'handshake-poll') {
          if (!e.ports || !e.ports.length) {
            throw new Error(
              'Did not receive communication port from the Viewer!');
          }
          resolve(e.ports[0]);
          unlisten();
        }
      });
    });
  }

  /**
   * @param {!../../../src/service/viewer-impl.Viewer} viewer
   * @param {!WindowPortEmulator} pipe
   * @return {!Promise<undefined>}
   * @private
   */
  openChannelAndStart_(viewer, pipe) {
    const messaging = new Messaging(this.win, pipe);
    dev().fine(TAG, 'Send a handshake request');
    return messaging.sendRequest(RequestNames.CHANNEL_OPEN, {}, true)
        .then(() => {
          dev().fine(TAG, 'Channel has been opened!');
          this.setup_(messaging, viewer);
        });
  }

  /**
   * @param {!Messaging} messaging
   * @param {!../../../src/service/viewer-impl.Viewer} viewer
   * @return {Promise<*>|undefined}
   * @private
   */
  setup_(messaging, viewer) {
    messaging.setRequestProcessor((type, payload, awaitResponse) => {
      return viewer.receiveMessage(
        type, /** @type {!JSONType} */ (payload), awaitResponse);
    });

    viewer.setMessageDeliverer(messaging.sendRequest.bind(messaging),
      dev().assertString(this.unconfirmedViewerOrigin_));

    listenOnce(
      this.win, 'unload', this.handleUnload_.bind(this, messaging));
  }

  /**
   * Notifies the viewer when this document is unloaded.
   * @param {!Messaging} messaging
   * @return {Promise<*>|undefined}
   * @private
   */
  handleUnload_(messaging) {
    return messaging.sendRequest(RequestNames.UNLOADED, {}, true);
  }
}

AMP.extension(TAG, '0.1', function(AMP) {
  new AmpViewerIntegration(AMP.win).init();
});
