// A tiny loopback HTTP/1.1 fixture for DemoServer tests. Real URLSession
// traffic hits 127.0.0.1; DemoURLProtocol is not involved. Synthetic data
// only. One accept thread, short requests, no TLS.
import Foundation

extension DemoServer {
    /// Bind an ephemeral loopback port and answer HTTP with `respond`.
    /// Returns the base URL (`http://127.0.0.1:<port>`). Call `stopListening`
    /// (or `stop`) when done.
    @discardableResult
    public func startListening() throws -> URL {
        lock.lock()
        if listener != nil {
            let url = listenerURL
            lock.unlock()
            guard let url else { throw URLError(.cannotConnectToHost) }
            return url
        }
        lock.unlock()

        let fd = socket(AF_INET, SOCK_STREAM, 0)
        guard fd >= 0 else { throw URLError(.cannotCreateFile) }
        var yes: Int32 = 1
        setsockopt(fd, SOL_SOCKET, SO_REUSEADDR, &yes, socklen_t(MemoryLayout.size(ofValue: yes)))
        var addr = sockaddr_in()
        addr.sin_len = UInt8(MemoryLayout<sockaddr_in>.size)
        addr.sin_family = sa_family_t(AF_INET)
        addr.sin_port = 0
        addr.sin_addr = in_addr(s_addr: inet_addr("127.0.0.1"))
        let bindResult = withUnsafePointer(to: &addr) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { bind(fd, $0, socklen_t(MemoryLayout<sockaddr_in>.size)) }
        }
        guard bindResult == 0 else { close(fd); throw URLError(.cannotConnectToHost) }
        guard listen(fd, 16) == 0 else { close(fd); throw URLError(.cannotConnectToHost) }

        var bound = sockaddr_in()
        var len = socklen_t(MemoryLayout<sockaddr_in>.size)
        let nameResult = withUnsafeMutablePointer(to: &bound) {
            $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { getsockname(fd, $0, &len) }
        }
        guard nameResult == 0 else { close(fd); throw URLError(.cannotConnectToHost) }
        let port = Int(UInt16(bigEndian: bound.sin_port))
        guard let url = URL(string: "http://127.0.0.1:\(port)") else { close(fd); throw URLError(.badURL) }

        let queue = DispatchQueue(label: "demo.sagax.listen.\(port)")
        lock.lock()
        listener = fd
        listenerURL = url
        listenerQueue = queue
        lock.unlock()

        queue.async { [weak self] in self?.acceptLoop(fd: fd) }
        return url
    }

    /// Close the loopback listener. Safe to call more than once.
    public func stopListening() {
        lock.lock()
        let fd = listener
        listener = nil
        listenerURL = nil
        listenerQueue = nil
        lock.unlock()
        if let fd, fd >= 0 { close(fd) }
    }

    /// The listening base URL while the fixture is up.
    public var listeningURL: URL? {
        lock.lock(); defer { lock.unlock() }
        return listenerURL
    }

    private func acceptLoop(fd: Int32) {
        while true {
            lock.lock(); let live = listener == fd; lock.unlock()
            guard live else { return }
            var client = sockaddr_in()
            var len = socklen_t(MemoryLayout<sockaddr_in>.size)
            let clientFD = withUnsafeMutablePointer(to: &client) {
                $0.withMemoryRebound(to: sockaddr.self, capacity: 1) { accept(fd, $0, &len) }
            }
            if clientFD < 0 {
                if errno == EINTR { continue }
                lock.lock(); let still = listener == fd; lock.unlock()
                if !still { return }
                continue
            }
            DispatchQueue.global(qos: .userInitiated).async { [weak self] in
                self?.serve(clientFD: clientFD)
            }
        }
    }

    private func serve(clientFD: Int32) {
        defer { close(clientFD) }
        var buffer = Data()
        var chunk = [UInt8](repeating: 0, count: 64 * 1024)
        var headersEnd: Int?
        var contentLength = 0
        while headersEnd == nil {
            let n = read(clientFD, &chunk, chunk.count)
            if n <= 0 { return }
            buffer.append(chunk, count: n)
            if let range = buffer.range(of: Data("\r\n\r\n".utf8)) {
                headersEnd = range.lowerBound
                let headerData = buffer.subdata(in: 0..<range.lowerBound)
                let headerText = String(data: headerData, encoding: .utf8) ?? ""
                for line in headerText.split(separator: "\r\n").dropFirst() {
                    let parts = line.split(separator: ":", maxSplits: 1).map { $0.trimmingCharacters(in: .whitespaces) }
                    if parts.count == 2, parts[0].lowercased() == "content-length", let value = Int(parts[1]) {
                        contentLength = max(0, value)
                    }
                }
                break
            }
            if buffer.count > 1024 * 1024 { return }
        }
        guard let headersEnd else { return }
        let bodyStart = headersEnd + 4
        while buffer.count < bodyStart + contentLength {
            let n = read(clientFD, &chunk, chunk.count)
            if n <= 0 { return }
            buffer.append(chunk, count: n)
            if buffer.count > bodyStart + DemoServer.uploadChunkMaxBytes + 1024 * 1024 { return }
        }

        let headerText = String(data: buffer.subdata(in: 0..<headersEnd), encoding: .utf8) ?? ""
        let lines = headerText.split(separator: "\r\n", omittingEmptySubsequences: false)
        guard let requestLine = lines.first else { return }
        let tokens = requestLine.split(separator: " ")
        guard tokens.count >= 2 else { return }
        let method = String(tokens[0])
        let target = String(tokens[1])
        var contentType: String?
        for line in lines.dropFirst() {
            let parts = line.split(separator: ":", maxSplits: 1).map { $0.trimmingCharacters(in: .whitespaces) }
            if parts.count == 2, parts[0].lowercased() == "content-type" { contentType = parts[1] }
        }
        let body = contentLength > 0 ? buffer.subdata(in: bodyStart..<(bodyStart + contentLength)) : nil
        let components = URLComponents(string: target)
        let path = components?.path ?? target.split(separator: "?").first.map(String.init) ?? target
        let query = components?.queryItems ?? []
        let answer = respond(method: method, path: path, body: body, query: query, contentType: contentType)
        let type = answer.contentType
        var response = "HTTP/1.1 \(answer.status) \(Self.statusText(answer.status))\r\n"
        response += "Content-Type: \(type)\r\n"
        response += "Content-Length: \(answer.body.count)\r\n"
        response += "Connection: close\r\n\r\n"
        var payload = Data(response.utf8)
        payload.append(answer.body)
        _ = payload.withUnsafeBytes { raw in
            guard let base = raw.bindMemory(to: UInt8.self).baseAddress else { return 0 }
            return write(clientFD, base, payload.count)
        }
    }

    private static func statusText(_ code: Int) -> String {
        switch code {
        case 200: return "OK"
        case 201: return "Created"
        case 400: return "Bad Request"
        case 403: return "Forbidden"
        case 404: return "Not Found"
        case 405: return "Method Not Allowed"
        case 409: return "Conflict"
        case 413: return "Payload Too Large"
        case 415: return "Unsupported Media Type"
        default: return "Error"
        }
    }
}
