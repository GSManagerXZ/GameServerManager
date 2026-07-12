namespace GSM3.Services;

using System.Collections.Concurrent;
using System.Diagnostics;
using System.Net;
using System.Net.Sockets;
using System.Text;
using GSM3.Models;

public class RconManager
{
    // Source RCON packet types
    private const int SERVERDATA_AUTH = 3;
    private const int SERVERDATA_AUTH_RESPONSE = 2;
    private const int SERVERDATA_EXECCOMMAND = 2;
    private const int SERVERDATA_RESPONSE_VALUE = 0;

    private readonly ConcurrentDictionary<string, RconConnection> _connections = new();

    public event EventHandler<RconStatusEventArgs>? OnStatusChanged;
    public event EventHandler<RconResponseEventArgs>? OnResponseReceived;

    public async Task<(bool Success, string? Error)> ConnectAsync(
        string connectionId, RconConfig config)
    {
        return await ConnectAsync(connectionId, config.Host, config.Port, config.Password);
    }

    public async Task<(bool Success, string? Error)> ConnectAsync(
        string connectionId, string host, int port, string password)
    {
        // Close existing connection with this ID if any
        await DisconnectAsync(connectionId);

        try
        {
            var client = new TcpClient();
            RaiseStatus(connectionId, RconStatus.Connecting);

            await client.ConnectAsync(IPAddress.Parse(host), port);

            var connection = new RconConnection
            {
                Id = connectionId,
                Host = host,
                Port = port,
                Client = client,
                Stream = client.GetStream()
            };

            _connections[connectionId] = connection;
            RaiseStatus(connectionId, RconStatus.Connected);

            // Authenticate
            var authResult = await AuthenticateInternalAsync(connection, password);
            if (!authResult.Success)
            {
                await DisconnectAsync(connectionId);
                RaiseStatus(connectionId, RconStatus.Error);
                return authResult;
            }

            connection.IsAuthenticated = true;
            RaiseStatus(connectionId, RconStatus.Authenticated);
            return (true, null);
        }
        catch (Exception ex)
        {
            RaiseStatus(connectionId, RconStatus.Error);
            return (false, $"Connection failed: {ex.Message}");
        }
    }

    public Task DisconnectAsync(string connectionId)
    {
        if (_connections.TryRemove(connectionId, out var conn))
        {
            try
            {
                conn.Stream?.Dispose();
                conn.Client?.Dispose();
            }
            catch { /* ignore cleanup errors */ }

            RaiseStatus(connectionId, RconStatus.Disconnected);
        }
        return Task.CompletedTask;
    }

    public async Task<(bool Success, string? Error)> AuthenticateAsync(string connectionId, string password)
    {
        if (!_connections.TryGetValue(connectionId, out var conn))
            return (false, "Not connected.");

        return await AuthenticateInternalAsync(conn, password);
    }

    public async Task<(bool Success, string? Response, string? Error)> ExecuteCommandAsync(
        string connectionId, string command)
    {
        if (!_connections.TryGetValue(connectionId, out var conn))
            return (false, null, "Not connected.");

        if (!conn.IsAuthenticated)
            return (false, null, "Not authenticated.");

        try
        {
            var requestId = conn.NextId();
            var packet = BuildPacket(requestId, SERVERDATA_EXECCOMMAND, command);
            await conn.Stream!.WriteAsync(packet);

            // Read response(s) - may come in multiple packets
            var responseBody = new StringBuilder();
            var response = await ReadPacketAsync(conn.Stream);
            if (response == null)
                return (false, null, "No response from server.");

            responseBody.Append(response.Value.Body);

            // Try reading additional packets with a short timeout (multi-packet responses)
            conn.Client!.ReceiveTimeout = 200;
            try
            {
                while (conn.Stream.DataAvailable)
                {
                    var extra = await ReadPacketAsync(conn.Stream);
                    if (extra == null) break;
                    responseBody.Append(extra.Value.Body);
                }
            }
            catch { /* timeout is expected */ }
            finally
            {
                conn.Client.ReceiveTimeout = 0;
            }

            var result = responseBody.ToString();
            OnResponseReceived?.Invoke(this,
                new RconResponseEventArgs(connectionId, command, result));

            return (true, result, null);
        }
        catch (Exception ex)
        {
            return (false, null, $"Command failed: {ex.Message}");
        }
    }

    public bool IsConnected(string connectionId) =>
        _connections.TryGetValue(connectionId, out var conn) &&
        conn.Client?.Connected == true;

    public void DisconnectAll()
    {
        foreach (var id in _connections.Keys.ToList())
        {
            _ = DisconnectAsync(id);
        }
    }

    // ── Packet Format ──────────────────────────────────────────
    // 4 bytes: packet size (int32 LE) = id(4) + type(4) + body + null(1) + null(1)
    // 4 bytes: request id (int32 LE)
    // 4 bytes: type (int32 LE)
    // N bytes: body (null-terminated ASCII)
    // 1 byte:  empty string terminator (0x00)

    private static byte[] BuildPacket(int id, int type, string body)
    {
        var bodyBytes = Encoding.ASCII.GetBytes(body);
        var packetSize = 4 + 4 + bodyBytes.Length + 1 + 1; // id + type + body + null + null

        var packet = new byte[4 + packetSize]; // size prefix + packet
        var offset = 0;

        // Size
        BitConverter.GetBytes(packetSize).CopyTo(packet, offset); offset += 4;
        // ID
        BitConverter.GetBytes(id).CopyTo(packet, offset); offset += 4;
        // Type
        BitConverter.GetBytes(type).CopyTo(packet, offset); offset += 4;
        // Body
        bodyBytes.CopyTo(packet, offset); offset += bodyBytes.Length;
        // Two null terminators
        packet[offset] = 0; offset++;
        packet[offset] = 0;

        return packet;
    }

    private static async Task<RconPacket?> ReadPacketAsync(NetworkStream stream)
    {
        // Read size (4 bytes)
        var sizeBuffer = new byte[4];
        var bytesRead = await ReadExactAsync(stream, sizeBuffer, 4);
        if (bytesRead < 4) return null;

        var packetSize = BitConverter.ToInt32(sizeBuffer, 0);
        if (packetSize < 10 || packetSize > 4096) return null;

        // Read rest of packet
        var body = new byte[packetSize];
        bytesRead = await ReadExactAsync(stream, body, packetSize);
        if (bytesRead < packetSize) return null;

        return new RconPacket
        {
            Size = packetSize,
            Id = BitConverter.ToInt32(body, 0),
            Type = BitConverter.ToInt32(body, 4),
            Body = Encoding.ASCII.GetString(body, 8, packetSize - 10) // minus id(4)+type(4)+null(1)+null(1)
        };
    }

    private static async Task<int> ReadExactAsync(NetworkStream stream, byte[] buffer, int count)
    {
        int totalRead = 0;
        while (totalRead < count)
        {
            var read = await stream.ReadAsync(buffer.AsMemory(totalRead, count - totalRead));
            if (read == 0) break;
            totalRead += read;
        }
        return totalRead;
    }

    private async Task<(bool Success, string? Error)> AuthenticateInternalAsync(
        RconConnection conn, string password)
    {
        try
        {
            var requestId = conn.NextId();
            var packet = BuildPacket(requestId, SERVERDATA_AUTH, password);
            await conn.Stream!.WriteAsync(packet);

            var response = await ReadPacketAsync(conn.Stream);
            if (response == null)
                return (false, "No response from server.");

            // Auth response: id matches = success, id == -1 = failure
            if (response.Value.Id == -1)
                return (false, "Authentication failed. Check password.");

            return (true, null);
        }
        catch (Exception ex)
        {
            return (false, $"Authentication error: {ex.Message}");
        }
    }

    private void RaiseStatus(string connectionId, RconStatus status)
    {
        OnStatusChanged?.Invoke(this, new RconStatusEventArgs(connectionId, status));
    }

    // ── Internal Types ─────────────────────────────────────────

    private class RconConnection
    {
        public string Id { get; set; } = string.Empty;
        public string Host { get; set; } = string.Empty;
        public int Port { get; set; }
        public TcpClient? Client { get; set; }
        public NetworkStream? Stream { get; set; }
        public bool IsAuthenticated { get; set; }
        private int _requestId;

        public int NextId() => Interlocked.Increment(ref _requestId);
    }

    private struct RconPacket
    {
        public int Size;
        public int Id;
        public int Type;
        public string Body;
    }
}

public class RconStatusEventArgs : EventArgs
{
    public string ConnectionId { get; }
    public RconStatus Status { get; }

    public RconStatusEventArgs(string connectionId, RconStatus status)
    {
        ConnectionId = connectionId;
        Status = status;
    }
}

public class RconResponseEventArgs : EventArgs
{
    public string ConnectionId { get; }
    public string Command { get; }
    public string Response { get; }

    public RconResponseEventArgs(string connectionId, string command, string response)
    {
        ConnectionId = connectionId;
        Command = command;
        Response = response;
    }
}
