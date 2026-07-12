namespace GSM3.Services;

using System.Net.Sockets;
using System.Text;

/// <summary>
/// Source RCON protocol implementation.
/// Packet format: [4-byte size LE][4-byte id LE][4-byte type LE][body ASCII][null][null]
/// Reference: https://developer.valvesoftware.com/wiki/Source_RCON_Protocol
/// </summary>
public class RconProtocol : IDisposable
{
    private TcpClient? _client;
    private NetworkStream? _stream;
    private int _packetId;
    private readonly object _lock = new();

    public bool IsConnected => _client?.Connected ?? false;

    public async Task ConnectAsync(string host, int port, int timeoutMs = 5000)
    {
        _client = new TcpClient();
        using var cts = new CancellationTokenSource(timeoutMs);
        await _client.ConnectAsync(host, port, cts.Token);
        _stream = _client.GetStream();
    }

    public async Task<bool> AuthenticateAsync(string password)
    {
        var response = await SendPacketAsync(3, password); // SERVERDATA_AUTH = 3
        return response.Type == 2; // SERVERDATA_AUTH_RESPONSE = 2
    }

    public async Task<string> ExecuteCommandAsync(string command)
    {
        var response = await SendPacketAsync(2, command); // SERVERDATA_EXECCOMMAND = 2
        return response.Body;
    }

    private async Task<RconPacket> SendPacketAsync(int type, string body)
    {
        if (_stream == null) throw new InvalidOperationException("Not connected");

        var id = Interlocked.Increment(ref _packetId);
        var bodyBytes = Encoding.UTF8.GetBytes(body);
        var size = 4 + 4 + bodyBytes.Length + 2; // id + type + body + 2 nulls

        var packet = new byte[4 + size];
        BitConverter.GetBytes(size).CopyTo(packet, 0);
        BitConverter.GetBytes(id).CopyTo(packet, 4);
        BitConverter.GetBytes(type).CopyTo(packet, 8);
        bodyBytes.CopyTo(packet, 12);
        // last 2 bytes are already 0 (null terminators)

        lock (_lock)
        {
            _stream.Write(packet, 0, packet.Length);
        }

        return await ReadPacketAsync();
    }

    private async Task<RconPacket> ReadPacketAsync()
    {
        if (_stream == null) throw new InvalidOperationException("Not connected");

        var sizeBuffer = new byte[4];
        await ReadExactAsync(_stream, sizeBuffer, 4);
        var size = BitConverter.ToInt32(sizeBuffer, 0);

        var payloadBuffer = new byte[size];
        await ReadExactAsync(_stream, payloadBuffer, size);

        return new RconPacket
        {
            Id = BitConverter.ToInt32(payloadBuffer, 0),
            Type = BitConverter.ToInt32(payloadBuffer, 4),
            Body = Encoding.UTF8.GetString(payloadBuffer, 8, size - 10) // minus id(4) + type(4) + 2 nulls
        };
    }

    private static async Task ReadExactAsync(NetworkStream stream, byte[] buffer, int count)
    {
        int offset = 0;
        while (offset < count)
        {
            int read = await stream.ReadAsync(buffer.AsMemory(offset, count - offset));
            if (read == 0) throw new IOException("Connection closed");
            offset += read;
        }
    }

    public void Disconnect()
    {
        _stream?.Dispose();
        _client?.Dispose();
        _stream = null;
        _client = null;
    }

    public void Dispose()
    {
        Disconnect();
        GC.SuppressFinalize(this);
    }
}

public struct RconPacket
{
    public int Id;
    public int Type;
    public string Body;
}
