import { Logger } from './Logger';
import {
	Transport,
	TransportListenIp,
	TransportTuple,
	TransportTraceEventData,
	TransportEvents,
	TransportObserverEvents,
	TransportConstructorOptions,
	SctpState
} from './Transport';
import { SctpParameters, NumSctpStreams } from './SctpParameters';
import { SrtpParameters, SrtpCryptoSuite } from './SrtpParameters';
import { AppData } from './types';

export type PlainTransportOptions<PlainTransportAppData extends AppData = AppData> =
{
	/**
	 * Listening IP address.
	 */
	listenIp: TransportListenIp | string;

	/**
	 * Fixed port to listen on instead of selecting automatically from Worker's port
	 * range.
	 */
	port?: number;

	/**
	 * Use RTCP-mux (RTP and RTCP in the same port). Default true.
	 */
	rtcpMux?: boolean;

	/**
	 * Whether remote IP:port should be auto-detected based on first RTP/RTCP
	 * packet received. If enabled, connect() method must not be called unless
	 * SRTP is enabled. If so, it must be called with just remote SRTP parameters.
	 * Default false.
	 */
	comedia?: boolean;

	/**
	 * Create a SCTP association. Default false.
	 */
	enableSctp?: boolean;

	/**
	 * SCTP streams number.
	 */
	numSctpStreams?: NumSctpStreams;

	/**
	 * Maximum allowed size for SCTP messages sent by DataProducers.
	 * Default 262144.
	 */
	maxSctpMessageSize?: number;

	/**
	 * Maximum SCTP send buffer used by DataConsumers.
	 * Default 262144.
	 */
	sctpSendBufferSize?: number;

	/**
	 * Enable SRTP. For this to work, connect() must be called
	 * with remote SRTP parameters. Default false.
	 */
	enableSrtp?: boolean;

	/**
	 * The SRTP crypto suite to be used if enableSrtp is set. Default
	 * 'AES_CM_128_HMAC_SHA1_80'.
	 */
	srtpCryptoSuite?: SrtpCryptoSuite;

	/**
	 * Custom application data.
	 */
	appData?: PlainTransportAppData;
};

export type PlainTransportStat =
{
	// Common to all Transports.
	type: string;
	transportId: string;
	timestamp: number;
	sctpState?: SctpState;
	bytesReceived: number;
	recvBitrate: number;
	bytesSent: number;
	sendBitrate: number;
	rtpBytesReceived: number;
	rtpRecvBitrate: number;
	rtpBytesSent: number;
	rtpSendBitrate: number;
	rtxBytesReceived: number;
	rtxRecvBitrate: number;
	rtxBytesSent: number;
	rtxSendBitrate: number;
	probationBytesSent: number;
	probationSendBitrate: number;
	availableOutgoingBitrate?: number;
	availableIncomingBitrate?: number;
	maxIncomingBitrate?: number;
	// PlainTransport specific.
	rtcpMux: boolean;
	comedia: boolean;
	tuple: TransportTuple;
	rtcpTuple?: TransportTuple;
};

export type PlainTransportEvents = TransportEvents &
{
	tuple: [TransportTuple];
	rtcptuple: [TransportTuple];
	sctpstatechange: [SctpState];
};

export type PlainTransportObserverEvents = TransportObserverEvents &
{
	tuple: [TransportTuple];
	rtcptuple: [TransportTuple];
	sctpstatechange: [SctpState];	
};

type PlainTransportConstructorOptions<PlainTransportAppData> =
	TransportConstructorOptions<PlainTransportAppData> &
	{
		data: PlainTransportData;
	};

export type PlainTransportData =
{
	rtcpMux?: boolean;
	comedia?: boolean;
	tuple: TransportTuple;
	rtcpTuple?: TransportTuple;
	sctpParameters?: SctpParameters;
	sctpState?: SctpState;
	srtpParameters?: SrtpParameters;
};

const logger = new Logger('PlainTransport');

export class PlainTransport<PlainTransportAppData extends AppData = AppData>
	extends Transport<PlainTransportAppData, PlainTransportEvents, PlainTransportObserverEvents>
{
	// PlainTransport data.
	readonly #data: PlainTransportData;

	/**
	 * @private
	 */
	constructor(options: PlainTransportConstructorOptions<PlainTransportAppData>)
	{
		super(options);

		logger.debug('constructor()');

		const { data } = options;

		this.#data =
		{
			rtcpMux        : data.rtcpMux,
			comedia        : data.comedia,
			tuple          : data.tuple,
			rtcpTuple      : data.rtcpTuple,
			sctpParameters : data.sctpParameters,
			sctpState      : data.sctpState,
			srtpParameters : data.srtpParameters
		};

		this.handleWorkerNotifications();
	}

	/**
	 * Transport tuple.
	 */
	get tuple(): TransportTuple
	{
		return this.#data.tuple;
	}

	/**
	 * Transport RTCP tuple.
	 */
	get rtcpTuple(): TransportTuple | undefined
	{
		return this.#data.rtcpTuple;
	}

	/**
	 * SCTP parameters.
	 */
	get sctpParameters(): SctpParameters | undefined
	{
		return this.#data.sctpParameters;
	}

	/**
	 * SCTP state.
	 */
	get sctpState(): SctpState | undefined
	{
		return this.#data.sctpState;
	}

	/**
	 * SRTP parameters.
	 */
	get srtpParameters(): SrtpParameters | undefined
	{
		return this.#data.srtpParameters;
	}

	/**
	 * Close the PlainTransport.
	 *
	 * @override
	 */
	close(): void
	{
		if (this.closed)
		{
			return;
		}

		if (this.#data.sctpState)
		{
			this.#data.sctpState = 'closed';
		}

		super.close();
	}

	/**
	 * Router was closed.
	 *
	 * @private
	 * @override
	 */
	routerClosed(): void
	{
		if (this.closed)
		{
			return;
		}

		if (this.#data.sctpState)
		{
			this.#data.sctpState = 'closed';
		}

		super.routerClosed();
	}

	/**
	 * Get PlainTransport stats.
	 *
	 * @override
	 */
	async getStats(): Promise<PlainTransportStat[]>
	{
		logger.debug('getStats()');

		return this.channel.request('transport.getStats', this.internal.transportId);
	}

	/**
	 * Provide the PlainTransport remote parameters.
	 *
	 * @override
	 */
	async connect(
		{
			ip,
			port,
			rtcpPort,
			srtpParameters
		}:
		{
			ip?: string;
			port?: number;
			rtcpPort?: number;
			srtpParameters?: SrtpParameters;
		}
	): Promise<void>
	{
		logger.debug('connect()');

		const reqData = { ip, port, rtcpPort, srtpParameters };

		const data =
			await this.channel.request('transport.connect', this.internal.transportId, reqData);

		// Update data.
		if (data.tuple)
		{
			this.#data.tuple = data.tuple;
		}

		if (data.rtcpTuple)
		{
			this.#data.rtcpTuple = data.rtcpTuple;
		}

		this.#data.srtpParameters = data.srtpParameters;
	}

	private handleWorkerNotifications(): void
	{
		this.channel.on(this.internal.transportId, (event: string, data?: any) =>
		{
			switch (event)
			{
				case 'tuple':
				{
					const tuple = data.tuple as TransportTuple;

					this.#data.tuple = tuple;

					this.safeEmit('tuple', tuple);

					// Emit observer event.
					this.observer.safeEmit('tuple', tuple);

					break;
				}

				case 'rtcptuple':
				{
					const rtcpTuple = data.rtcpTuple as TransportTuple;

					this.#data.rtcpTuple = rtcpTuple;

					this.safeEmit('rtcptuple', rtcpTuple);

					// Emit observer event.
					this.observer.safeEmit('rtcptuple', rtcpTuple);

					break;
				}

				case 'sctpstatechange':
				{
					const sctpState = data.sctpState as SctpState;

					this.#data.sctpState = sctpState;

					this.safeEmit('sctpstatechange', sctpState);

					// Emit observer event.
					this.observer.safeEmit('sctpstatechange', sctpState);

					break;
				}

				case 'trace':
				{
					const trace = data as TransportTraceEventData;

					this.safeEmit('trace', trace);

					// Emit observer event.
					this.observer.safeEmit('trace', trace);

					break;
				}

				default:
				{
					logger.error('ignoring unknown event "%s"', event);
				}
			}
		});
	}
}
