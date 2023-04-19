import { v4 as uuidv4 } from 'uuid';
import { Logger } from './Logger';
import { EnhancedEventEmitter } from './EnhancedEventEmitter';
import * as utils from './utils';
import * as ortc from './ortc';
import { Channel } from './Channel';
import { PayloadChannel } from './PayloadChannel';
import { RouterInternal } from './Router';
import { WebRtcTransportData } from './WebRtcTransport';
import { PlainTransportData } from './PlainTransport';
import { PipeTransportData } from './PipeTransport';
import { DirectTransportData } from './DirectTransport';
import { Producer, ProducerOptions } from './Producer';
import { Consumer, ConsumerOptions, ConsumerType } from './Consumer';
import {
	DataProducer,
	DataProducerOptions,
	DataProducerType
} from './DataProducer';
import {
	DataConsumer,
	DataConsumerOptions,
	DataConsumerType
} from './DataConsumer';
import { RtpCapabilities } from './RtpParameters';
import { SctpStreamParameters } from './SctpParameters';
import { AppData } from './types';

export type TransportListenIp =
{
	/**
	 * Listening IPv4 or IPv6.
	 */
	ip: string;

	/**
	 * Announced IPv4 or IPv6 (useful when running mediasoup behind NAT with
	 * private IP).
	 */
	announcedIp?: string;
};

/**
 * Transport protocol.
 */
export type TransportProtocol = 'udp' | 'tcp';

export type TransportTuple =
{
	localIp: string;
	localPort: number;
	remoteIp?: string;
	remotePort?: number;
	protocol: TransportProtocol;
};

/**
 * Valid types for 'trace' event.
 */
export type TransportTraceEventType = 'probation' | 'bwe';

/**
 * 'trace' event data.
 */
export type TransportTraceEventData =
{
	/**
	 * Trace type.
	 */
	type: TransportTraceEventType;

	/**
	 * Event timestamp.
	 */
	timestamp: number;

	/**
	 * Event direction.
	 */
	direction: 'in' | 'out';

	/**
	 * Per type information.
	 */
	info: any;
};

export type SctpState = 'new' | 'connecting' | 'connected' | 'failed' | 'closed';

export type TransportEvents =
{
	routerclose: [];
	listenserverclose: [];
	trace: [TransportTraceEventData];
	// Private events.
	'@close': [];
	'@newproducer': [Producer];
	'@producerclose': [Producer];
	'@newdataproducer': [DataProducer];
	'@dataproducerclose': [DataProducer];
	'@listenserverclose': [];
};

export type TransportObserverEvents =
{
	close: [];
	newproducer: [Producer];
	newconsumer: [Consumer];
	newdataproducer: [DataProducer];
	newdataconsumer: [DataConsumer];
	trace: [TransportTraceEventData];
};

export type TransportConstructorOptions<TransportAppData> =
{
	internal: TransportInternal;
	data: TransportData;
	channel: Channel;
	payloadChannel: PayloadChannel;
	appData?: TransportAppData;
	getRouterRtpCapabilities: () => RtpCapabilities;
	getProducerById: (producerId: string) => Producer | undefined;
	getDataProducerById: (dataProducerId: string) => DataProducer | undefined;
};

export type TransportInternal = RouterInternal &
{
	transportId: string;
};

type TransportData =
  | WebRtcTransportData
  | PlainTransportData
  | PipeTransportData
  | DirectTransportData;

const logger = new Logger('Transport');

export class Transport
	<TransportAppData extends AppData = AppData,
	Events extends TransportEvents = TransportEvents,
	ObserverEvents extends TransportObserverEvents = TransportObserverEvents>
	extends EnhancedEventEmitter<Events>
{
	// Internal data.
	protected readonly internal: TransportInternal;

	// Transport data. This is set by the subclass.
	readonly #data: TransportData;

	// Channel instance.
	protected readonly channel: Channel;

	// PayloadChannel instance.
	protected readonly payloadChannel: PayloadChannel;

	// Close flag.
	#closed = false;

	// Custom app data.
	#appData: TransportAppData;

	// Method to retrieve Router RTP capabilities.
	readonly #getRouterRtpCapabilities: () => RtpCapabilities;

	// Method to retrieve a Producer.
	protected readonly getProducerById: (producerId: string) => Producer | undefined;

	// Method to retrieve a DataProducer.
	protected readonly getDataProducerById:
		(dataProducerId: string) => DataProducer | undefined;

	// Producers map.
	readonly #producers: Map<string, Producer> = new Map();

	// Consumers map.
	protected readonly consumers: Map<string, Consumer> = new Map();

	// DataProducers map.
	protected readonly dataProducers: Map<string, DataProducer> = new Map();

	// DataConsumers map.
	protected readonly dataConsumers: Map<string, DataConsumer> = new Map();

	// RTCP CNAME for Producers.
	#cnameForProducers?: string;

	// Next MID for Consumers. It's converted into string when used.
	#nextMidForConsumers = 0;

	// Buffer with available SCTP stream ids.
	#sctpStreamIds?: Buffer;

	// Next SCTP stream id.
	#nextSctpStreamId = 0;

	// Observer instance.
	readonly #observer = new EnhancedEventEmitter<ObserverEvents>();

	/**
	 * @private
	 * @interface
	 */
	constructor(
		{
			internal,
			data,
			channel,
			payloadChannel,
			appData,
			getRouterRtpCapabilities,
			getProducerById,
			getDataProducerById
		}: TransportConstructorOptions<TransportAppData>
	)
	{
		super();

		logger.debug('constructor()');

		this.internal = internal;
		this.#data = data;
		this.channel = channel;
		this.payloadChannel = payloadChannel;
		this.#appData = appData || {} as TransportAppData;
		this.#getRouterRtpCapabilities = getRouterRtpCapabilities;
		this.getProducerById = getProducerById;
		this.getDataProducerById = getDataProducerById;
	}

	/**
	 * Transport id.
	 */
	get id(): string
	{
		return this.internal.transportId;
	}

	/**
	 * Whether the Transport is closed.
	 */
	get closed(): boolean
	{
		return this.#closed;
	}

	/**
	 * App custom data.
	 */
	get appData(): TransportAppData
	{
		return this.#appData;
	}

	/**
	 * App custom data setter.
	 */
	set appData(appData: TransportAppData)
	{
		this.#appData = appData;
	}

	/**
	 * Observer.
	 */
	get observer(): EnhancedEventEmitter<ObserverEvents>
	{
		return this.#observer;
	}

	/**
	 * @private
	 * Just for testing purposes.
	 */
	get channelForTesting(): Channel
	{
		return this.channel;
	}

	/**
	 * Close the Transport.
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
		this.channel.removeAllListeners(this.internal.transportId);
		this.payloadChannel.removeAllListeners(this.internal.transportId);

		const reqData = { transportId: this.internal.transportId };

		this.channel.request('router.closeTransport', this.internal.routerId, reqData)
			.catch(() => {});

		// Close every Producer.
		for (const producer of this.#producers.values())
		{
			producer.transportClosed();

			// Must tell the Router.
			this.emit('@producerclose', producer);
		}
		this.#producers.clear();

		// Close every Consumer.
		for (const consumer of this.consumers.values())
		{
			consumer.transportClosed();
		}
		this.consumers.clear();

		// Close every DataProducer.
		for (const dataProducer of this.dataProducers.values())
		{
			dataProducer.transportClosed();

			// Must tell the Router.
			this.emit('@dataproducerclose', dataProducer);
		}
		this.dataProducers.clear();

		// Close every DataConsumer.
		for (const dataConsumer of this.dataConsumers.values())
		{
			dataConsumer.transportClosed();
		}
		this.dataConsumers.clear();

		this.emit('@close');

		// Emit observer event.
		this.#observer.safeEmit('close');
	}

	/**
	 * Router was closed.
	 *
	 * @private
	 * @virtual
	 */
	routerClosed(): void
	{
		if (this.#closed)
		{
			return;
		}

		logger.debug('routerClosed()');

		this.#closed = true;

		// Remove notification subscriptions.
		this.channel.removeAllListeners(this.internal.transportId);
		this.payloadChannel.removeAllListeners(this.internal.transportId);

		// Close every Producer.
		for (const producer of this.#producers.values())
		{
			producer.transportClosed();

			// NOTE: No need to tell the Router since it already knows (it has
			// been closed in fact).
		}
		this.#producers.clear();

		// Close every Consumer.
		for (const consumer of this.consumers.values())
		{
			consumer.transportClosed();
		}
		this.consumers.clear();

		// Close every DataProducer.
		for (const dataProducer of this.dataProducers.values())
		{
			dataProducer.transportClosed();

			// NOTE: No need to tell the Router since it already knows (it has
			// been closed in fact).
		}
		this.dataProducers.clear();

		// Close every DataConsumer.
		for (const dataConsumer of this.dataConsumers.values())
		{
			dataConsumer.transportClosed();
		}
		this.dataConsumers.clear();

		this.safeEmit('routerclose');

		// Emit observer event.
		this.#observer.safeEmit('close');
	}

	/**
	 * Listen server was closed (this just happens in WebRtcTransports when their
	 * associated WebRtcServer is closed).
	 *
	 * @private
	 */
	listenServerClosed(): void
	{
		if (this.#closed)
		{
			return;
		}

		logger.debug('listenServerClosed()');

		this.#closed = true;

		// Remove notification subscriptions.
		this.channel.removeAllListeners(this.internal.transportId);
		this.payloadChannel.removeAllListeners(this.internal.transportId);

		// Close every Producer.
		for (const producer of this.#producers.values())
		{
			producer.transportClosed();

			// NOTE: No need to tell the Router since it already knows (it has
			// been closed in fact).
		}
		this.#producers.clear();

		// Close every Consumer.
		for (const consumer of this.consumers.values())
		{
			consumer.transportClosed();
		}
		this.consumers.clear();

		// Close every DataProducer.
		for (const dataProducer of this.dataProducers.values())
		{
			dataProducer.transportClosed();

			// NOTE: No need to tell the Router since it already knows (it has
			// been closed in fact).
		}
		this.dataProducers.clear();

		// Close every DataConsumer.
		for (const dataConsumer of this.dataConsumers.values())
		{
			dataConsumer.transportClosed();
		}
		this.dataConsumers.clear();

		// Need to emit this event to let the parent Router know since
		// transport.listenServerClosed() is called by the listen server.
		// NOTE: Currently there is just WebRtcServer for WebRtcTransports.
		this.emit('@listenserverclose');

		this.safeEmit('listenserverclose');

		// Emit observer event.
		this.#observer.safeEmit('close');
	}

	/**
	 * Dump Transport.
	 */
	async dump(): Promise<any>
	{
		logger.debug('dump()');

		return this.channel.request('transport.dump', this.internal.transportId);
	}

	/**
	 * Get Transport stats.
	 *
	 * @abstract
	 */
	async getStats(): Promise<any[]>
	{
		// Should not happen.
		throw new Error('method not implemented in the subclass');
	}

	/**
	 * Provide the Transport remote parameters.
	 *
	 * @abstract
	 */
	// eslint-disable-next-line @typescript-eslint/no-unused-vars
	async connect(params: any): Promise<void>
	{
		// Should not happen.
		throw new Error('method not implemented in the subclass');
	}

	/**
	 * Set maximum incoming bitrate for receiving media.
	 */
	async setMaxIncomingBitrate(bitrate: number): Promise<void>
	{
		logger.debug('setMaxIncomingBitrate() [bitrate:%s]', bitrate);

		const reqData = { bitrate };

		await this.channel.request(
			'transport.setMaxIncomingBitrate', this.internal.transportId, reqData);
	}

	/**
	 * Set maximum outgoing bitrate for sending media.
	 */
	async setMaxOutgoingBitrate(bitrate: number): Promise<void>
	{
		logger.debug('setMaxOutgoingBitrate() [bitrate:%s]', bitrate);

		const reqData = { bitrate };

		await this.channel.request(
			'transport.setMaxOutgoingBitrate', this.internal.transportId, reqData);
	}

	/**
	 * Set minimum outgoing bitrate for sending media.
	 */
	async setMinOutgoingBitrate(bitrate: number): Promise<void>
	{
		logger.debug('setMinOutgoingBitrate() [bitrate:%s]', bitrate);

		const reqData = { bitrate };

		await this.channel.request(
			'transport.setMinOutgoingBitrate', this.internal.transportId, reqData);
	}

	/**
	 * Create a Producer.
	 */
	async produce<ProducerAppData extends AppData = AppData>(
		{
			id = undefined,
			kind,
			rtpParameters,
			paused = false,
			keyFrameRequestDelay,
			appData
		}: ProducerOptions<ProducerAppData>
	): Promise<Producer<ProducerAppData>>
	{
		logger.debug('produce()');

		if (id && this.#producers.has(id))
		{
			throw new TypeError(`a Producer with same id "${id}" already exists`);
		}
		else if (![ 'audio', 'video' ].includes(kind))
		{
			throw new TypeError(`invalid kind "${kind}"`);
		}
		else if (appData && typeof appData !== 'object')
		{
			throw new TypeError('if given, appData must be an object');
		}

		// This may throw.
		ortc.validateRtpParameters(rtpParameters);

		// If missing or empty encodings, add one.
		if (
			!rtpParameters.encodings ||
			!Array.isArray(rtpParameters.encodings) ||
			rtpParameters.encodings.length === 0
		)
		{
			rtpParameters.encodings = [ {} ];
		}

		// Don't do this in PipeTransports since there we must keep CNAME value in
		// each Producer.
		if (this.constructor.name !== 'PipeTransport')
		{
			// If CNAME is given and we don't have yet a CNAME for Producers in this
			// Transport, take it.
			if (!this.#cnameForProducers && rtpParameters.rtcp && rtpParameters.rtcp.cname)
			{
				this.#cnameForProducers = rtpParameters.rtcp.cname;
			}
			// Otherwise if we don't have yet a CNAME for Producers and the RTP parameters
			// do not include CNAME, create a random one.
			else if (!this.#cnameForProducers)
			{
				this.#cnameForProducers = uuidv4().substr(0, 8);
			}

			// Override Producer's CNAME.
			rtpParameters.rtcp = rtpParameters.rtcp || {};
			rtpParameters.rtcp.cname = this.#cnameForProducers;
		}

		const routerRtpCapabilities = this.#getRouterRtpCapabilities();

		// This may throw.
		const rtpMapping = ortc.getProducerRtpParametersMapping(
			rtpParameters, routerRtpCapabilities);

		// This may throw.
		const consumableRtpParameters = ortc.getConsumableRtpParameters(
			kind, rtpParameters, routerRtpCapabilities, rtpMapping);

		const reqData =
		{
			producerId : id || uuidv4(),
			kind,
			rtpParameters,
			rtpMapping,
			keyFrameRequestDelay,
			paused
		};

		const status =
			await this.channel.request('transport.produce', this.internal.transportId, reqData);

		const data =
		{
			kind,
			rtpParameters,
			type : status.type,
			consumableRtpParameters
		};

		const producer = new Producer<ProducerAppData>(
			{
				internal :
				{
					...this.internal,
					producerId : reqData.producerId
				},
				data,
				channel        : this.channel,
				payloadChannel : this.payloadChannel,
				appData,
				paused
			});

		this.#producers.set(producer.id, producer);
		producer.on('@close', () =>
		{
			this.#producers.delete(producer.id);
			this.emit('@producerclose', producer);
		});

		this.emit('@newproducer', producer);

		// Emit observer event.
		this.#observer.safeEmit('newproducer', producer);

		return producer;
	}

	/**
	 * Create a Consumer.
	 *
	 * @virtual
	 */
	async consume<ConsumerAppData extends AppData = AppData>(
		{
			producerId,
			rtpCapabilities,
			paused = false,
			mid,
			preferredLayers,
			ignoreDtx = false,
			enableRtx,
			pipe = false,
			appData
		}: ConsumerOptions<ConsumerAppData>
	): Promise<Consumer<ConsumerAppData>>
	{
		logger.debug('consume()');

		if (!producerId || typeof producerId !== 'string')
		{
			throw new TypeError('missing producerId');
		}
		else if (appData && typeof appData !== 'object')
		{
			throw new TypeError('if given, appData must be an object');
		}
		else if (mid && (typeof mid !== 'string' || mid.length === 0))
		{
			throw new TypeError('if given, mid must be non empty string');
		}

		// This may throw.
		ortc.validateRtpCapabilities(rtpCapabilities!);

		const producer = this.getProducerById(producerId);

		if (!producer)
		{
			throw Error(`Producer with id "${producerId}" not found`);
		}

		// If enableRtx is not given, set it to true if video and false if audio.
		if (enableRtx === undefined)
		{
			enableRtx = producer.kind === 'video';
		}

		// This may throw.
		const rtpParameters = ortc.getConsumerRtpParameters(
			{
				consumableRtpParameters : producer.consumableRtpParameters,
				remoteRtpCapabilities   : rtpCapabilities!,
				pipe,
				enableRtx
			}
		);

		// Set MID.
		if (!pipe)
		{
			if (mid)
			{
				rtpParameters.mid = mid;
			}
			else
			{
				rtpParameters.mid = `${this.#nextMidForConsumers++}`;

				// We use up to 8 bytes for MID (string).
				if (this.#nextMidForConsumers === 100000000)
				{
					logger.error(
						`consume() | reaching max MID value "${this.#nextMidForConsumers}"`);

					this.#nextMidForConsumers = 0;
				}
			}
		}

		const reqData =
		{
			consumerId             : uuidv4(),
			producerId,
			kind                   : producer.kind,
			rtpParameters,
			type                   : pipe ? 'pipe' : producer.type,
			consumableRtpEncodings : producer.consumableRtpParameters.encodings,
			paused,
			preferredLayers,
			ignoreDtx
		};

		const status =
			await this.channel.request('transport.consume', this.internal.transportId, reqData);

		const data =
		{
			producerId,
			kind : producer.kind,
			rtpParameters,
			type : pipe ? 'pipe' : producer.type as ConsumerType
		};

		const consumer = new Consumer<ConsumerAppData>(
			{
				internal :
				{
					...this.internal,
					consumerId : reqData.consumerId
				},
				data,
				channel         : this.channel,
				payloadChannel  : this.payloadChannel,
				appData,
				paused          : status.paused,
				producerPaused  : status.producerPaused,
				score           : status.score,
				preferredLayers : status.preferredLayers
			});

		this.consumers.set(consumer.id, consumer);
		consumer.on('@close', () => this.consumers.delete(consumer.id));
		consumer.on('@producerclose', () => this.consumers.delete(consumer.id));

		// Emit observer event.
		this.#observer.safeEmit('newconsumer', consumer);

		return consumer;
	}

	/**
	 * Create a DataProducer.
	 */
	async produceData<DataProducerAppData extends AppData = AppData>(
		{
			id = undefined,
			sctpStreamParameters,
			label = '',
			protocol = '',
			appData
		}: DataProducerOptions<DataProducerAppData> = {}
	): Promise<DataProducer<DataProducerAppData>>
	{
		logger.debug('produceData()');

		if (id && this.dataProducers.has(id))
		{
			throw new TypeError(`a DataProducer with same id "${id}" already exists`);
		}
		else if (appData && typeof appData !== 'object')
		{
			throw new TypeError('if given, appData must be an object');
		}

		let type: DataProducerType;

		// If this is not a DirectTransport, sctpStreamParameters are required.
		if (this.constructor.name !== 'DirectTransport')
		{
			type = 'sctp';

			// This may throw.
			ortc.validateSctpStreamParameters(sctpStreamParameters!);
		}
		// If this is a DirectTransport, sctpStreamParameters must not be given.
		else
		{
			type = 'direct';

			if (sctpStreamParameters)
			{
				logger.warn(
					'produceData() | sctpStreamParameters are ignored when producing data on a DirectTransport');
			}
		}

		const reqData =
		{
			dataProducerId : id || uuidv4(),
			type,
			sctpStreamParameters,
			label,
			protocol
		};

		const data =
			await this.channel.request('transport.produceData', this.internal.transportId, reqData);

		const dataProducer = new DataProducer<DataProducerAppData>(
			{
				internal :
				{
					...this.internal,
					dataProducerId : reqData.dataProducerId
				},
				data,
				channel        : this.channel,
				payloadChannel : this.payloadChannel,
				appData
			});

		this.dataProducers.set(dataProducer.id, dataProducer);
		dataProducer.on('@close', () =>
		{
			this.dataProducers.delete(dataProducer.id);
			this.emit('@dataproducerclose', dataProducer);
		});

		this.emit('@newdataproducer', dataProducer);

		// Emit observer event.
		this.#observer.safeEmit('newdataproducer', dataProducer);

		return dataProducer;
	}

	/**
	 * Create a DataConsumer.
	 */
	async consumeData<ConsumerAppData extends AppData = AppData>(
		{
			dataProducerId,
			ordered,
			maxPacketLifeTime,
			maxRetransmits,
			appData
		}: DataConsumerOptions<ConsumerAppData>
	): Promise<DataConsumer<ConsumerAppData>>
	{
		logger.debug('consumeData()');

		if (!dataProducerId || typeof dataProducerId !== 'string')
		{
			throw new TypeError('missing dataProducerId');
		}
		else if (appData && typeof appData !== 'object')
		{
			throw new TypeError('if given, appData must be an object');
		}

		const dataProducer = this.getDataProducerById(dataProducerId);

		if (!dataProducer)
		{
			throw Error(`DataProducer with id "${dataProducerId}" not found`);
		}

		let type: DataConsumerType;
		let sctpStreamParameters: SctpStreamParameters | undefined;
		let sctpStreamId: number;

		// If this is not a DirectTransport, use sctpStreamParameters from the
		// DataProducer (if type 'sctp') unless they are given in method parameters.
		if (this.constructor.name !== 'DirectTransport')
		{
			type = 'sctp';
			sctpStreamParameters =
				utils.clone(dataProducer.sctpStreamParameters) as SctpStreamParameters;

			// Override if given.
			if (ordered !== undefined)
			{
				sctpStreamParameters.ordered = ordered;
			}

			if (maxPacketLifeTime !== undefined)
			{
				sctpStreamParameters.maxPacketLifeTime = maxPacketLifeTime;
			}

			if (maxRetransmits !== undefined)
			{
				sctpStreamParameters.maxRetransmits = maxRetransmits;
			}

			// This may throw.
			sctpStreamId = this.getNextSctpStreamId();

			this.#sctpStreamIds![sctpStreamId] = 1;
			sctpStreamParameters.streamId = sctpStreamId;
		}
		// If this is a DirectTransport, sctpStreamParameters must not be used.
		else
		{
			type = 'direct';

			if (
				ordered !== undefined ||
				maxPacketLifeTime !== undefined ||
				maxRetransmits !== undefined
			)
			{
				logger.warn(
					'consumeData() | ordered, maxPacketLifeTime and maxRetransmits are ignored when consuming data on a DirectTransport');
			}
		}

		const { label, protocol } = dataProducer;

		const reqData =
		{
			dataConsumerId : uuidv4(),
			dataProducerId,
			type,
			sctpStreamParameters,
			label,
			protocol
		};

		const data =
			await this.channel.request('transport.consumeData', this.internal.transportId, reqData);

		const dataConsumer = new DataConsumer<ConsumerAppData>(
			{
				internal :
				{
					...this.internal,
					dataConsumerId : reqData.dataConsumerId
				},
				data,
				channel        : this.channel,
				payloadChannel : this.payloadChannel,
				appData
			});

		this.dataConsumers.set(dataConsumer.id, dataConsumer);
		dataConsumer.on('@close', () =>
		{
			this.dataConsumers.delete(dataConsumer.id);

			if (this.#sctpStreamIds)
			{
				this.#sctpStreamIds[sctpStreamId] = 0;
			}
		});
		dataConsumer.on('@dataproducerclose', () =>
		{
			this.dataConsumers.delete(dataConsumer.id);

			if (this.#sctpStreamIds)
			{
				this.#sctpStreamIds[sctpStreamId] = 0;
			}
		});

		// Emit observer event.
		this.#observer.safeEmit('newdataconsumer', dataConsumer);

		return dataConsumer;
	}

	/**
	 * Enable 'trace' event.
	 */
	async enableTraceEvent(types: TransportTraceEventType[] = []): Promise<void>
	{
		logger.debug('pause()');

		const reqData = { types };

		await this.channel.request(
			'transport.enableTraceEvent', this.internal.transportId, reqData);
	}

	private getNextSctpStreamId(): number
	{
		if (
			!this.#data.sctpParameters ||
			typeof this.#data.sctpParameters.MIS !== 'number'
		)
		{
			throw new TypeError('missing sctpParameters.MIS');
		}

		const numStreams = this.#data.sctpParameters.MIS;

		if (!this.#sctpStreamIds)
		{
			this.#sctpStreamIds = Buffer.alloc(numStreams, 0);
		}

		let sctpStreamId;

		for (let idx = 0; idx < this.#sctpStreamIds.length; ++idx)
		{
			sctpStreamId = (this.#nextSctpStreamId + idx) % this.#sctpStreamIds.length;

			if (!this.#sctpStreamIds[sctpStreamId])
			{
				this.#nextSctpStreamId = sctpStreamId + 1;

				return sctpStreamId;
			}
		}

		throw new Error('no sctpStreamId available');
	}
}
