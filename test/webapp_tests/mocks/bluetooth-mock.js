// Complete mock of the Web Bluetooth API for testing the BLE Mouse Controller.
// Injected via page.addInitScript() before the app loads.

const NUS_SERVICE_UUID = '6e400001-b5a3-f393-e0a9-e50e24dcca9e';
const NUS_RX_UUID      = '6e400002-b5a3-f393-e0a9-e50e24dcca9e';
const NUS_TX_UUID      = '6e400003-b5a3-f393-e0a9-e50e24dcca9e';

window.__bluetoothMock = {
  commands: [],

  _device: null,
  _gattServer: null,
  _txCharacteristic: null,

  reset() {
    this.commands = [];
    this._device = null;
    this._gattServer = null;
    this._txCharacteristic = null;
  },

  disconnectSimulated() {
    if (this._gattServer) {
      this._gattServer._connected = false;
    }
    if (this._device && this._device._onDisconnected) {
      this._device._onDisconnected();
    }
  },

  sendDeviceResponse(text) {
    if (this._txCharacteristic && this._txCharacteristic._onChanged) {
      this._txCharacteristic._onChanged({
        target: { value: new TextEncoder().encode(text) }
      });
    }
  },
};

navigator.bluetooth = {
  requestDevice: async () => {
    const mock = window.__bluetoothMock;

    const txChar = {
      uuid: NUS_TX_UUID,
      _onChanged: null,

      startNotifications: async () => txChar,
      addEventListener: (event, fn) => {
        if (event === 'characteristicvaluechanged') {
          txChar._onChanged = fn;
        }
      },
    };

    const nusService = {
      uuid: NUS_SERVICE_UUID,
      getCharacteristic: async (uuid) => {
        if (uuid === NUS_RX_UUID) {
          return {
            uuid: NUS_RX_UUID,
            writeValue: async (data) => {
              const text = new TextDecoder().decode(data);
              mock.commands.push(text);
            },
          };
        }
        if (uuid === NUS_TX_UUID) {
          mock._txCharacteristic = txChar;
          return txChar;
        }
        throw new Error('Characteristic not found: ' + uuid);
      },
    };

    const gattServer = {
      _connected: false,
      get connected() { return gattServer._connected; },

      connect: async () => {
        gattServer._connected = true;
        return gattServer;
      },

      disconnect: () => {
        gattServer._connected = false;
        if (device._onDisconnected) {
          device._onDisconnected();
        }
      },

      getPrimaryServices: async () => [nusService],
    };

    const device = {
      name: 'Mock BLE Mouse',
      gatt: gattServer,
      _onDisconnected: null,
      addEventListener: (event, fn) => {
        if (event === 'gattserverdisconnected') {
          device._onDisconnected = fn;
        }
      },
    };

    mock._device = device;
    mock._gattServer = gattServer;

    return device;
  },

  getAvailability: async () => true,
  getDevices: async () => [],
};
