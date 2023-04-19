import { Logger } from './Logger';
import { EnhancedEventEmitter } from './EnhancedEventEmitter';
import { Channel } from './Channel';
import { TransportProtocol } from './Transport';
import { WebRtcTransport } from './WebRtcTransport';
import { AppData } from './types';

export type WebRtcServerOptions<WebRtcServerAppData extends AppData = AppData> =
{
	/**
	 * Listen infos.
	 */
	listenInfos: WebRtcServerListenInfo[];

	/**
	 * Custom application data.
	 */
	appData?: WebRtcServerAppData;
};

export type WebRtcServerListenInfo =
{
	/**
	 * Network protocol.
	 */
	protocol: TransportProtocol;

	/**
	 * Listening IPv4 or IPv6.
	 */
	ip: string;

	/**
	 * Announced IPv4 or IPv6 (useful when running mediasoup behind NAT with
	 * private IP).
	 */
	announcedIp?: string;

	/**
	 * Listening port.
	 */
	port?: number;
};

export type WebRtcServerEvents =
{ 
	workerclose: [];
	// Private events.
	'@close': [];
};

export type WebRtcServerObserverEvents =
{
	close: [];
	webrtctransporthandled: [WebRtcTransport];
	webrtctransportunhandled: [WebRtcTransport];
};

type WebRtcServerInternal =
{
	webRtcServerId: string;
};

const logger = new Logger('WebRtcServer');

export class WebRtcServer<WebRtcServerAppData extends AppData = AppData>
	extends EnhancedEventEmitter<WebRtcServerEvents>
{
	// Internal data.
	readonly #internal: WebRtcServerInternal;

	// Channel instance.
	readonly #channel: Channel;

	// Closed flag.
	#closed = false;

	// Custom app data.
	#appData: WebRtcServerAppData;

	// Transports map.
	readonly #webRtcTransports: Map<string, WebRtcTransport> = new Map();

	// Observer instance.
	readonly #observer = new EnhancedEventEmitter<WebRtcServerObserverEvents>();

	/**
	 * @private
	 */
	constructor(
		{
			internal,
			channel,
			appData
		}:
		{
			internal: WebRtcServerInternal;
			channel: Channel;
			appData?: WebRtcServerAppData;
		}
	)
	{
		super();

		logger.debug('constructor()');

		this.#internal = internal;
		this.#channel = channel;
		this.#appData = appData || {} as WebRtcServerAppData;
	}

	/**
	 * WebRtcServer id.
	 */
	get id(): string
	{
		return this.#internal.webRtcServerId;
	}

	/**
	 * Whether the WebRtcServer is closed.
	 */
	get closed(): boolean
	{
		return this.#closed;
	}

	/**
	 * App custom data.
	 */
	get appData(): WebRtcServerAppData
	{
		return this.#appData;
	}

	/**
	 * App custom data setter.
	 */
	set appData(appData: WebRtcServerAppData)
	{
		this.#appData = appData;
	}

	/**
	 * Observer.
	 */
	get observer(): EnhancedEventEmitter<WebRtcServerObserverEvents>
	{
		return this.#observer;
	}

	/**
	 * @private
	 * Just for testing purposes.
	 */
	get webRtcTransportsForTesting(): Map<string, WebRtcTransport>
	{
		return this.#webRtcTransports;
	}

	/**
	 * Close the WebRtcServer.
	 */
	close(): void
	{
		if (this.#closed)
		{
			return;
		}

		logger.debug('close()');

		this.#closed = true;

		const reqData = { webRtcServerId: this.#internal.webRtcServerId };

		this.#channel.request('worker.closeWebRtcServer', undefined, reqData)
			.catch(() => {});

		// Close every WebRtcTransport.
		for (const webRtcTransport of this.#webRtcTransports.values())
		{
			webRtcTransport.listenServerClosed();

			// Emit observer event.
			this.#observer.safeEmit('webrtctransportunhandled', webRtcTransport);
		}
		this.#webRtcTransports.clear();

		this.emit('@close');

		// Emit observer event.
		this.#observer.safeEmit('close');
	}

	/**
	 * Worker was closed.
	 *
	 * @private
	 */
	workerClosed(): void
	{
		if (this.#closed)
		{
			return;
		}

		logger.debug('workerClosed()');

		this.#closed = true;

		// NOTE: No need to close WebRtcTransports since they are closed by their
		// respective Router parents.
		this.#webRtcTransports.clear();

		this.safeEmit('workerclose');

		// Emit observer event.
		this.#observer.safeEmit('close');
	}

	/**
	 * Dump WebRtcServer.
	 */
	async dump(): Promise<any>
	{
		logger.debug('dump()');

		return this.#channel.request('webRtcServer.dump', this.#internal.webRtcServerId);
	}

	/**
	 * @private
	 */
	handleWebRtcTransport(webRtcTransport: WebRtcTransport): void
	{
		this.#webRtcTransports.set(webRtcTransport.id, webRtcTransport);

		// Emit observer event.
		this.#observer.safeEmit('webrtctransporthandled', webRtcTransport);

		webRtcTransport.on('@close', () =>
		{
			this.#webRtcTransports.delete(webRtcTransport.id);

			// Emit observer event.
			this.#observer.safeEmit('webrtctransportunhandled', webRtcTransport);
		});
	}
}
