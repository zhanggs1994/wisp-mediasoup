import { Logger } from './Logger';
import { EnhancedEventEmitter } from './EnhancedEventEmitter';
import { Channel } from './Channel';
import { PayloadChannel } from './PayloadChannel';
import { TransportInternal } from './Transport';
import { SctpStreamParameters } from './SctpParameters';
import { AppData } from './types';

export type DataProducerOptions<DataProducerAppData extends AppData = AppData> =
{
	/**
	 * DataProducer id (just for Router.pipeToRouter() method).
	 */
	id?: string;

	/**
	 * SCTP parameters defining how the endpoint is sending the data.
	 * Just if messages are sent over SCTP.
	 */
	sctpStreamParameters?: SctpStreamParameters;

	/**
	 * A label which can be used to distinguish this DataChannel from others.
	 */
	label?: string;

	/**
	 * Name of the sub-protocol used by this DataChannel.
	 */
	protocol?: string;

	/**
	 * Custom application data.
	 */
	appData?: DataProducerAppData;
};

export type DataProducerStat =
{
	type: string;
	timestamp: number;
	label: string;
	protocol: string;
	messagesReceived: number;
	bytesReceived: number;
};

/**
 * DataProducer type.
 */
export type DataProducerType = 'sctp' | 'direct';

export type DataProducerEvents =
{
	transportclose: [];
	// Private events.
	'@close': [];
};

export type DataProducerObserverEvents =
{
	close: [];
};

type DataProducerInternal = TransportInternal &
{
	dataProducerId: string;
};

type DataProducerData =
{
	type: DataProducerType;
	sctpStreamParameters?: SctpStreamParameters;
	label: string;
	protocol: string;
};

const logger = new Logger('DataProducer');

export class DataProducer<DataProducerAppData extends AppData = AppData>
	extends EnhancedEventEmitter<DataProducerEvents>
{
	// Internal data.
	readonly #internal: DataProducerInternal;

	// DataProducer data.
	readonly #data: DataProducerData;

	// Channel instance.
	readonly #channel: Channel;

	// PayloadChannel instance.
	readonly #payloadChannel: PayloadChannel;

	// Closed flag.
	#closed = false;

	// Custom app data.
	#appData: DataProducerAppData;

	// Observer instance.
	readonly #observer = new EnhancedEventEmitter<DataProducerObserverEvents>();

	/**
	 * @private
	 */
	constructor(
		{
			internal,
			data,
			channel,
			payloadChannel,
			appData
		}:
		{
			internal: DataProducerInternal;
			data: DataProducerData;
			channel: Channel;
			payloadChannel: PayloadChannel;
			appData?: DataProducerAppData;
		}
	)
	{
		super();

		logger.debug('constructor()');

		this.#internal = internal;
		this.#data = data;
		this.#channel = channel;
		this.#payloadChannel = payloadChannel;
		this.#appData = appData || {} as DataProducerAppData;

		this.handleWorkerNotifications();
	}

	/**
	 * DataProducer id.
	 */
	get id(): string
	{
		return this.#internal.dataProducerId;
	}

	/**
	 * Whether the DataProducer is closed.
	 */
	get closed(): boolean
	{
		return this.#closed;
	}

	/**
	 * DataProducer type.
	 */
	get type(): DataProducerType
	{
		return this.#data.type;
	}

	/**
	 * SCTP stream parameters.
	 */
	get sctpStreamParameters(): SctpStreamParameters | undefined
	{
		return this.#data.sctpStreamParameters;
	}

	/**
	 * DataChannel label.
	 */
	get label(): string
	{
		return this.#data.label;
	}

	/**
	 * DataChannel protocol.
	 */
	get protocol(): string
	{
		return this.#data.protocol;
	}

	/**
	 * App custom data.
	 */
	get appData(): DataProducerAppData
	{
		return this.#appData;
	}

	/**
	 * App custom data setter.
	 */
	set appData(appData: DataProducerAppData)
	{
		this.#appData = appData;
	}

	/**
	 * Observer.
	 */
	get observer(): EnhancedEventEmitter<DataProducerObserverEvents>
	{
		return this.#observer;
	}

	/**
	 * Close the DataProducer.
	 */
	close(): void
	{
		if (this.#closed)
		{
			return;
		}

		logger.debug('close()');

		this.#closed = true;

		// Remove notification subscriptions.
		this.#channel.removeAllListeners(this.#internal.dataProducerId);
		this.#payloadChannel.removeAllListeners(this.#internal.dataProducerId);

		const reqData = { dataProducerId: this.#internal.dataProducerId };

		this.#channel.request('transport.closeDataProducer', this.#internal.transportId, reqData)
			.catch(() => {});

		this.emit('@close');

		// Emit observer event.
		this.#observer.safeEmit('close');
	}

	/**
	 * Transport was closed.
	 *
	 * @private
	 */
	transportClosed(): void
	{
		if (this.#closed)
		{
			return;
		}

		logger.debug('transportClosed()');

		this.#closed = true;

		// Remove notification subscriptions.
		this.#channel.removeAllListeners(this.#internal.dataProducerId);
		this.#payloadChannel.removeAllListeners(this.#internal.dataProducerId);

		this.safeEmit('transportclose');

		// Emit observer event.
		this.#observer.safeEmit('close');
	}

	/**
	 * Dump DataProducer.
	 */
	async dump(): Promise<any>
	{
		logger.debug('dump()');

		return this.#channel.request('dataProducer.dump', this.#internal.dataProducerId);
	}

	/**
	 * Get DataProducer stats.
	 */
	async getStats(): Promise<DataProducerStat[]>
	{
		logger.debug('getStats()');

		return this.#channel.request('dataProducer.getStats', this.#internal.dataProducerId);
	}

	/**
	 * Send data (just valid for DataProducers created on a DirectTransport).
	 */
	send(message: string | Buffer, ppid?: number): void
	{
		if (typeof message !== 'string' && !Buffer.isBuffer(message))
		{
			throw new TypeError('message must be a string or a Buffer');
		}

		/*
		 * +-------------------------------+----------+
		 * | Value                         | SCTP     |
		 * |                               | PPID     |
		 * +-------------------------------+----------+
		 * | WebRTC String                 | 51       |
		 * | WebRTC Binary Partial         | 52       |
		 * | (Deprecated)                  |          |
		 * | WebRTC Binary                 | 53       |
		 * | WebRTC String Partial         | 54       |
		 * | (Deprecated)                  |          |
		 * | WebRTC String Empty           | 56       |
		 * | WebRTC Binary Empty           | 57       |
		 * +-------------------------------+----------+
		 */

		if (typeof ppid !== 'number')
		{
			ppid = (typeof message === 'string')
				? message.length > 0 ? 51 : 56
				: message.length > 0 ? 53 : 57;
		}

		// Ensure we honor PPIDs.
		if (ppid === 56)
		{
			message = ' ';
		}
		else if (ppid === 57)
		{
			message = Buffer.alloc(1);
		}

		const notifData = String(ppid);

		this.#payloadChannel.notify(
			'dataProducer.send', this.#internal.dataProducerId, notifData, message);
	}

	private handleWorkerNotifications(): void
	{
		// No need to subscribe to any event.
	}
}
