import { Logger } from './Logger';
import {
	Transport,
	TransportListenIp,
	TransportProtocol,
	TransportTuple,
	TransportTraceEventData,
	TransportEvents,
	TransportObserverEvents,
	TransportConstructorOptions,
	SctpState
} from './Transport';
import { WebRtcServer } from './WebRtcServer';
import { SctpParameters, NumSctpStreams } from './SctpParameters';
import { Either } from './utils';
import { AppData } from './types';

export type WebRtcTransportOptions<WebRtcTransportAppData extends AppData = AppData> =
	WebRtcTransportOptionsBase<WebRtcTransportAppData> & WebRtcTransportListen;

export type WebRtcTransportListenIndividual =
{
	/**
	 * Listening IP address or addresses in order of preference (first one is the
	 * preferred one). Mandatory unless webRtcServer is given.
	 */
	listenIps: (TransportListenIp | string)[];

	/**
	 * Fixed port to listen on instead of selecting automatically from Worker's port
	 * range.
	 */
	port?: number;
};

export type WebRtcTransportListenServer =
{
	/**
	 * Instance of WebRtcServer. Mandatory unless listenIps is given.
	 */
	webRtcServer: WebRtcServer;
};

export type WebRtcTransportListen =
	Either<WebRtcTransportListenIndividual, WebRtcTransportListenServer>;

export type WebRtcTransportOptionsBase<WebRtcTransportAppData> =
{
	/**
	 * Listen in UDP. Default true.
	 */
	enableUdp?: boolean;

	/**
	 * Listen in TCP. Default false.
	 */
	enableTcp?: boolean;

	/**
	 * Prefer UDP. Default false.
	 */
	preferUdp?: boolean;

	/**
	 * Prefer TCP. Default false.
	 */
	preferTcp?: boolean;

	/**
	 * Initial available outgoing bitrate (in bps). Default 600000.
	 */
	initialAvailableOutgoingBitrate?: number;

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
	 * Custom application data.
	 */
	appData?: WebRtcTransportAppData;
};

export type IceParameters =
{
	usernameFragment: string;
	password: string;
	iceLite?: boolean;
};

export type IceCandidate =
{
	foundation: string;
	priority: number;
	ip: string;
	protocol: TransportProtocol;
	port: number;
	type: 'host';
	tcpType: 'passive' | undefined;
};

export type DtlsParameters =
{
	role?: DtlsRole;
	fingerprints: DtlsFingerprint[];
};

/**
 * The hash function algorithm (as defined in the "Hash function Textual Names"
 * registry initially specified in RFC 4572 Section 8) and its corresponding
 * certificate fingerprint value (in lowercase hex string as expressed utilizing
 * the syntax of "fingerprint" in RFC 4572 Section 5).
 */
export type DtlsFingerprint =
{
	algorithm: string;
	value: string;
};

export type IceState = 'new' | 'connected' | 'completed' | 'disconnected' | 'closed';

export type DtlsRole = 'auto' | 'client' | 'server';

export type DtlsState = 'new' | 'connecting' | 'connected' | 'failed' | 'closed';

export type WebRtcTransportStat =
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
	// WebRtcTransport specific.
	iceRole: string;
	iceState: IceState;
	iceSelectedTuple?: TransportTuple;
	dtlsState: DtlsState;
};

export type WebRtcTransportEvents = TransportEvents &
{
	icestatechange: [IceState];
	iceselectedtuplechange: [TransportTuple];
	dtlsstatechange: [DtlsState];
	sctpstatechange: [SctpState];
};

export type WebRtcTransportObserverEvents = TransportObserverEvents &
{
	icestatechange: [IceState];
	iceselectedtuplechange: [TransportTuple];
	dtlsstatechange: [DtlsState];
	sctpstatechange: [SctpState];
};

type WebRtcTransportConstructorOptions<WebRtcTransportAppData> =
	TransportConstructorOptions<WebRtcTransportAppData> &
	{
		data: WebRtcTransportData;
	};

export type WebRtcTransportData =
{
	iceRole: 'controlled';
	iceParameters: IceParameters;
	iceCandidates: IceCandidate[];
	iceState: IceState;
	iceSelectedTuple?: TransportTuple;
	dtlsParameters: DtlsParameters;
	dtlsState: DtlsState;
	dtlsRemoteCert?: string;
	sctpParameters?: SctpParameters;
	sctpState?: SctpState;
};

const logger = new Logger('WebRtcTransport');

export class WebRtcTransport<WebRtcTransportAppData extends AppData = AppData>
	extends Transport<WebRtcTransportAppData, WebRtcTransportEvents, WebRtcTransportObserverEvents>
{
	// WebRtcTransport data.
	readonly #data: WebRtcTransportData;

	/**
	 * @private
	 */
	constructor(options: WebRtcTransportConstructorOptions<WebRtcTransportAppData>)
	{
		super(options);

		logger.debug('constructor()');

		const { data } = options;

		this.#data =
		{
			iceRole          : data.iceRole,
			iceParameters    : data.iceParameters,
			iceCandidates    : data.iceCandidates,
			iceState         : data.iceState,
			iceSelectedTuple : data.iceSelectedTuple,
			dtlsParameters   : data.dtlsParameters,
			dtlsState        : data.dtlsState,
			dtlsRemoteCert   : data.dtlsRemoteCert,
			sctpParameters   : data.sctpParameters,
			sctpState        : data.sctpState
		};

		this.handleWorkerNotifications();
	}

	/**
	 * ICE role.
	 */
	get iceRole(): 'controlled'
	{
		return this.#data.iceRole;
	}

	/**
	 * ICE parameters.
	 */
	get iceParameters(): IceParameters
	{
		return this.#data.iceParameters;
	}

	/**
	 * ICE candidates.
	 */
	get iceCandidates(): IceCandidate[]
	{
		return this.#data.iceCandidates;
	}

	/**
	 * ICE state.
	 */
	get iceState(): IceState
	{
		return this.#data.iceState;
	}

	/**
	 * ICE selected tuple.
	 */
	get iceSelectedTuple(): TransportTuple | undefined
	{
		return this.#data.iceSelectedTuple;
	}

	/**
	 * DTLS parameters.
	 */
	get dtlsParameters(): DtlsParameters
	{
		return this.#data.dtlsParameters;
	}

	/**
	 * DTLS state.
	 */
	get dtlsState(): DtlsState
	{
		return this.#data.dtlsState;
	}

	/**
	 * Remote certificate in PEM format.
	 */
	get dtlsRemoteCert(): string | undefined
	{
		return this.#data.dtlsRemoteCert;
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
	 * Close the WebRtcTransport.
	 *
	 * @override
	 */
	close(): void
	{
		if (this.closed)
		{
			return;
		}

		this.#data.iceState = 'closed';
		this.#data.iceSelectedTuple = undefined;
		this.#data.dtlsState = 'closed';

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

		this.#data.iceState = 'closed';
		this.#data.iceSelectedTuple = undefined;
		this.#data.dtlsState = 'closed';

		if (this.#data.sctpState)
		{
			this.#data.sctpState = 'closed';
		}

		super.routerClosed();
	}

	/**
	 * Called when closing the associated WebRtcServer.
	 *
	 * @private
	 */
	webRtcServerClosed(): void
	{
		if (this.closed)
		{
			return;
		}

		this.#data.iceState = 'closed';
		this.#data.iceSelectedTuple = undefined;
		this.#data.dtlsState = 'closed';

		if (this.#data.sctpState)
		{
			this.#data.sctpState = 'closed';
		}

		super.listenServerClosed();
	}

	/**
	 * Get WebRtcTransport stats.
	 *
	 * @override
	 */
	async getStats(): Promise<WebRtcTransportStat[]>
	{
		logger.debug('getStats()');

		return this.channel.request('transport.getStats', this.internal.transportId);
	}

	/**
	 * Provide the WebRtcTransport remote parameters.
	 *
	 * @override
	 */
	async connect({ dtlsParameters }: { dtlsParameters: DtlsParameters }): Promise<void>
	{
		logger.debug('connect()');

		const reqData = { dtlsParameters };

		const data =
			await this.channel.request('transport.connect', this.internal.transportId, reqData);

		// Update data.
		this.#data.dtlsParameters.role = data.dtlsLocalRole;
	}

	/**
	 * Restart ICE.
	 */
	async restartIce(): Promise<IceParameters>
	{
		logger.debug('restartIce()');

		const data =
			await this.channel.request('transport.restartIce', this.internal.transportId);

		const { iceParameters } = data;

		this.#data.iceParameters = iceParameters;

		return iceParameters;
	}

	private handleWorkerNotifications(): void
	{
		this.channel.on(this.internal.transportId, (event: string, data?: any) =>
		{
			switch (event)
			{
				case 'icestatechange':
				{
					const iceState = data.iceState as IceState;

					this.#data.iceState = iceState;

					this.safeEmit('icestatechange', iceState);

					// Emit observer event.
					this.observer.safeEmit('icestatechange', iceState);

					break;
				}

				case 'iceselectedtuplechange':
				{
					const iceSelectedTuple = data.iceSelectedTuple as TransportTuple;

					this.#data.iceSelectedTuple = iceSelectedTuple;

					this.safeEmit('iceselectedtuplechange', iceSelectedTuple);

					// Emit observer event.
					this.observer.safeEmit('iceselectedtuplechange', iceSelectedTuple);

					break;
				}

				case 'dtlsstatechange':
				{
					const dtlsState = data.dtlsState as DtlsState;
					const dtlsRemoteCert = data.dtlsRemoteCert as string;

					this.#data.dtlsState = dtlsState;

					if (dtlsState === 'connected')
					{
						this.#data.dtlsRemoteCert = dtlsRemoteCert;
					}

					this.safeEmit('dtlsstatechange', dtlsState);

					// Emit observer event.
					this.observer.safeEmit('dtlsstatechange', dtlsState);

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
