/**
 * Local TLS Market Server for app installation.
 *
 * Implements a minimal HTTPS server that mimics Sony's PlayMemories Camera Apps portal.
 * The camera connects to this server (via the USB SSL proxy) to download and install apps.
 *
 * Flow:
 * 1. Camera POSTs its device info to the portal URL
 * 2. Server responds with a JSON action telling the camera to download an SPK file
 * 3. Camera GETs the SPK file
 * 4. Server responds with the SPK data
 * 5. Camera installs the app
 *
 * Based on the Python Sony-PMCA-RE MarketServer implementation.
 */

import https from 'https';
import type { IncomingMessage, ServerResponse } from 'http';

/** MIME type for SPK packages — also used for JSON responses (quirk of the Sony protocol) */
const SPK_MIME_TYPE = 'application/vnd.sony.spk.package-archive';

/** SPK file extension used in Content-Disposition */
const SPK_EXTENSION = '.1.spk';

/**
 * Wildcard TLS certificate for *.localtest.me (resolves to 127.0.0.1).
 * Trusted by Sony cameras. Source: Sony-PMCA-RE project.
 * Contains RSA private key + certificate chain.
 */
const LOCALTEST_ME_PEM = `-----BEGIN RSA PRIVATE KEY-----
MIIEowIBAAKCAQEAvibcbBKCJGCpDkJts/iJpqSJysQdpKGzNaLtN4bHU6dN43B1
U4lyu8kUy+PWrzrd2j4GWswkallN2LoUUUgkyLIwHTvtg2JpifZjrVELSAn/j2e2
xGad7/aTkjYxM2pCpo1RQb7Th3fp2L6jKZV2+xQq8wF6Cm3N6uQ3wV4NMWS6zjuQ
PRg6/Xv5P7aKclvuEHWWzsgsKpgjSgqrXIQXVHZN1mbiX2YiZULetLo6RBOi3DN1
ZqhYe/MFL4cIFKbWurRPU7lc8zHKMiUCJmS4UGFer4584nSKOdjN4vlv7r1xkXCu
OwPl3X1wradA2g/GSj1lcT8SKuMsxjt5iEN3XwIDAQABAoIBAAdsAOJ+/nFpDHAw
C5QguU610WMGsJmCbjpDt7qZGiKbvyCHfSzbiozl1lf29qQ0SgCAt0LIAQvdnHo/
GRfrFvR2cAZUFnswVio6Yb2cEjKnoT/5rlqQHs4E89GbJ+R3204g6fEE/8Cj347E
Mh4nZVN7gAmoHxlVG9p1Oe/kOeOZl5x8kg/oG0KmppzY4JhFU1DjINCKPdoCVMiW
UpMofNR3GLGmvlEbSqVOQC8Q2L188gb3jk3JqGEpmsmakDC5zapwDNEYFiasbeqk
HpU+fQRT+OHfmVATmKgZ3/TfR9fC0DgCfrlj3e/jiRzocJkjCilbDmYBYnSaUTcn
7ygL4zECgYEAyO3B21Dr0yuvgtV0c0UxHdi/fR3RlL2ya7vFIpqvUHR9VLMvKJGO
+/D9nv/0cuTB6T8X82SyjxJoA/oSt5cMLr6AGqHkmOP//stv2Rhr6SUxBqQ+YCNp
OEkiUXGgRp3XTsI8LDKpMk5qYrgvyMQUhgCe6K4Liaa3qR0LkrexdEMCgYEA8kTv
iz4FQh1EOtGXAz79OBPWwXScSCNr8U8clgT6NRDRbSdG8Nyw8fQUqXUFDDFQkpeL
d92JFco4WFsmEunjrJCMWWivAwhUw0mubsXO81C4IQRCYghpHrsEipRAeHlDz6mB
GClSKXm14a4OPHtL+/6jhA/iBgP+GNSBiL5AbLUCgYB+KTt1t+O7Hkz/u4N49VMX
yIbDyrtTx6CGIMpxJes6e0pOqovLz0mWTAUTlucoVRakm+cv/mRXjVkeViD2gbM2
jorlLg3ZKiANHjPGfp0TMTUNVIeN2e4xV0pjFRNsA6OzYiZiIhU27yHBhqEKUIQK
d81PkCjSb4oWd5RStWCI/QKBgQCNyyT8NPd045YsasDcyIAB0zKtFSfm3LxvhmLv
tsgOSOKZ5RQTIsd5RObW60NiCHbk5Udeh02VcD6cD/Tvuu5i8FMEfU15E+YwSi6K
bMGcDNFHmauUnuGPd9vHk89L84VpxAZncr/AwJhgFrQEWBF30mg3gehCpxGPzMhn
lRo1xQKBgBwCkfb7wqOrE40cArrckwaMIMkRmbt3XZ1Uu2IXUHJogdIkS2Evpfpr
ddhwxnSc6jihZQXsZLrgI30F/i7lW8RRTZQVEyxNvA37J7qlu4ZlCapx7bQ12cq2
qHcheDNDYDy36t7jqSg4vYG7XA0GPdPVd8luNsqDmpxPtjwCbH6t
-----END RSA PRIVATE KEY-----
-----BEGIN CERTIFICATE-----
MIIFEDCCA/igAwIBAgIRALdZa5azVLbb1FosG+jnHWIwDQYJKoZIhvcNAQEFBQAw
cjELMAkGA1UEBhMCR0IxGzAZBgNVBAgTEkdyZWF0ZXIgTWFuY2hlc3RlcjEQMA4G
A1UEBxMHU2FsZm9yZDEaMBgGA1UEChMRQ09NT0RPIENBIExpbWl0ZWQxGDAWBgNV
BAMTD0Vzc2VudGlhbFNTTCBDQTAeFw0xMjA1MTcwMDAwMDBaFw0xMzA1MTcyMzU5
NTlaMFwxITAfBgNVBAsTGERvbWFpbiBDb250cm9sIFZhbGlkYXRlZDEeMBwGA1UE
CxMVRXNzZW50aWFsU1NMIFdpbGRjYXJkMRcwFQYDVQQDFA4qLmxvY2FsdGVzdC5t
ZTCCASIwDQYJKoZIhvcNAQEBBQADggEPADCCAQoCggEBAL4m3GwSgiRgqQ5CbbP4
iaakicrEHaShszWi7TeGx1OnTeNwdVOJcrvJFMvj1q863do+BlrMJGpZTdi6FFFI
JMiyMB077YNiaYn2Y61RC0gJ/49ntsRmne/2k5I2MTNqQqaNUUG+04d36di+oymV
dvsUKvMBegptzerkN8FeDTFkus47kD0YOv17+T+2inJb7hB1ls7ILCqYI0oKq1yE
F1R2TdZm4l9mImVC3rS6OkQTotwzdWaoWHvzBS+HCBSm1rq0T1O5XPMxyjIlAiZk
uFBhXq+OfOJ0ijnYzeL5b+69cZFwrjsD5d19cK2nQNoPxko9ZXE/EirjLMY7eYhD
d18CAwEAAaOCAbUwggGxMB8GA1UdIwQYMBaAFNrL6q1bCF3M//wmVM5J5VXGOPT4
MB0GA1UdDgQWBBRs5gYy3q9qoUierx3PwgRwJCBh5DAOBgNVHQ8BAf8EBAMCBaAw
DAYDVR0TAQH/BAIwADA0BgNVHSUELTArBggrBgEFBQcDAQYIKwYBBQUHAwIGCisG
AQQBgjcKAwMGCWCGSAGG+EIEATBFBgNVHSAEPjA8MDoGCysGAQQBsjEBAgIHMCsw
KQYIKwYBBQUHAgEWHWh0dHBzOi8vc2VjdXJlLmNvbW9kby5jb20vQ1BTMDsGA1Ud
HwQ0MDIwMKAuoCyGKmh0dHA6Ly9jcmwuY29tb2RvY2EuY29tL0Vzc2VudGlhbFNT
TENBLmNybDBuBggrBgEFBQcBAQRiMGAwOAYIKwYBBQUHMAKGLGh0dHA6Ly9jcnQu
Y29tb2RvY2EuY29tL0Vzc2VudGlhbFNTTENBXzIuY3J0MCQGCCsGAQUFBzABhhho
dHRwOi8vb2NzcC5jb21vZG9jYS5jb20wJwYDVR0RBCAwHoIOKi5sb2NhbHRlc3Qu
bWWCDGxvY2FsdGVzdC5tZTANBgkqhkiG9w0BAQUFAAOCAQEATxMTIV65LNbcSp+p
JnddpbQbiJixh1OF1Xw6Q7seAAgjKHz9fYSVsLsgqAJNgAT6WYM9TB+v/PCVmEHo
wsh8LntSX1w7RbzAhyQhsFCMejIfHhXiOKfCJ5dQHd94RH3M/pPaueokRNd/fxtU
caor9Zd8Evird0g8ZbJRkXXDrrQQibvSG3gJgPNPYU//0S/5wprq751ufXYHGH1n
Z62dVjG/k6Ul3At5HyWduHO927NRY/GYHxXIgzWbVQQ4upSOO1wp0n6Ro3zFsQZC
+0ZTzicWGpC7CixUwXp7ph2B9g/+Xlc2iu71E+s1yJTRObHzW7oyivIws1D5XZZd
yN6haQ==
-----END CERTIFICATE-----
-----BEGIN CERTIFICATE-----
MIIFAzCCA+ugAwIBAgIQGLLLuqME8aAPwfLzJkYqSjANBgkqhkiG9w0BAQUFADCB
gTELMAkGA1UEBhMCR0IxGzAZBgNVBAgTEkdyZWF0ZXIgTWFuY2hlc3RlcjEQMA4G
A1UEBxMHU2FsZm9yZDEaMBgGA1UEChMRQ09NT0RPIENBIExpbWl0ZWQxJzAlBgNV
BAMTHkNPTU9ETyBDZXJ0aWZpY2F0aW9uIEF1dGhvcml0eTAeFw0wNjEyMDEwMDAw
MDBaFw0xOTEyMzEyMzU5NTlaMHIxCzAJBgNVBAYTAkdCMRswGQYDVQQIExJHcmVh
dGVyIE1hbmNoZXN0ZXIxEDAOBgNVBAcTB1NhbGZvcmQxGjAYBgNVBAoTEUNPTU9E
TyBDQSBMaW1pdGVkMRgwFgYDVQQDEw9Fc3NlbnRpYWxTU0wgQ0EwggEiMA0GCSqG
SIb3DQEBAQUAA4IBDwAwggEKAoIBAQCt8AiwcsargxIxF3CJhakgEtSYau2A1NHf
5I5ZLdOWIY120j8YC0YZYwvHIPPlC92AGvFaoL0dds23Izp0XmEbdaqb1IX04XiR
0y3hr/yYLgbSeT1awB8hLRyuIVPGOqchfr7tZ291HRqfalsGs2rjsQuqag7nbWzD
ypWMN84hHzWQfdvaGlyoiBSyD8gSIF/F03/o4Tjg27z5H6Gq1huQByH6RSRQXScq
oChBRVt9vKCiL6qbfltTxfEFFld+Edc7tNkBdtzffRDPUanlOPJ7FAB1WfnwWdsX
Pvev5gItpHnBXaIcw5rIp6gLSApqLn8tl2X2xQScRMiZln5+pN0vAgMBAAGjggGD
MIIBfzAfBgNVHSMEGDAWgBQLWOWLxkwVN6RAqTCpIb5HNlpW/zAdBgNVHQ4EFgQU
2svqrVsIXcz//CZUzknlVcY49PgwDgYDVR0PAQH/BAQDAgEGMBIGA1UdEwEB/wQI
MAYBAf8CAQAwIAYDVR0lBBkwFwYKKwYBBAGCNwoDAwYJYIZIAYb4QgQBMD4GA1Ud
IAQ3MDUwMwYEVR0gADArMCkGCCsGAQUFBwIBFh1odHRwczovL3NlY3VyZS5jb21v
ZG8uY29tL0NQUzBJBgNVHR8EQjBAMD6gPKA6hjhodHRwOi8vY3JsLmNvbW9kb2Nh
LmNvbS9DT01PRE9DZXJ0aWZpY2F0aW9uQXV0aG9yaXR5LmNybDBsBggrBgEFBQcB
AQRgMF4wNgYIKwYBBQUHMAKGKmh0dHA6Ly9jcnQuY29tb2RvY2EuY29tL0NvbW9k
b1VUTlNHQ0NBLmNydDAkBggrBgEFBQcwAYYYaHR0cDovL29jc3AuY29tb2RvY2Eu
Y29tMA0GCSqGSIb3DQEBBQUAA4IBAQAtlzR6QDLqcJcvgTtLeRJ3rvuq1xqo2l/z
odueTZbLN3qo6u6bldudu+Ennv1F7Q5Slqz0J790qpL0pcRDAB8OtXj5isWMcL2a
ejGjKdBZa0wztSz4iw+SY1dWrCRnilsvKcKxudokxeRiDn55w/65g+onO7wdQ7Vu
F6r7yJiIatnyfKH2cboZT7g440LX8NqxwCPf3dfxp+0Jj1agq8MLy6SSgIGSH6lv
+Wwz3D5XxqfyH8wqfOQsTEZf6/Nh9yvENZ+NWPU6g0QO2JOsTGvMd/QDzczc4BxL
XSXaPV7Od4rhPsbXlM1wSTz/Dr0ISKvlUhQVnQ6cGodWaK2cCQBk
-----END CERTIFICATE-----`;

export interface MarketServerOptions {
  /** Raw SPK data to serve to the camera */
  spkData: Uint8Array;
  /** Host to bind to (default: 127.0.0.1) */
  host?: string;
  /** Port to listen on (default: 0 = random available port) */
  port?: number;
}

export interface MarketServerInstance {
  /** The port the server is listening on */
  port: number;
  /** The full base URL for the server */
  url: string;
  /** Device info received from the camera (available after first POST) */
  deviceInfo: Record<string, unknown> | null;
  /** Shut down the server */
  close: () => void;
}

/**
 * Start a local TLS market server that serves an SPK file to the camera.
 *
 * @param options - Server configuration including the SPK data to serve.
 * @returns A running server instance with port info and shutdown method.
 */
export function startMarketServer(options: MarketServerOptions): Promise<MarketServerInstance> {
  const { spkData, host = '127.0.0.1', port = 0 } = options;

  // Extract private key and certificates from embedded PEM
  const keyMatch = LOCALTEST_ME_PEM.match(
    /-----BEGIN RSA PRIVATE KEY-----[\s\S]+?-----END RSA PRIVATE KEY-----/,
  );
  const certMatches = LOCALTEST_ME_PEM.match(
    /-----BEGIN CERTIFICATE-----[\s\S]+?-----END CERTIFICATE-----/g,
  );

  if (!keyMatch || !certMatches) {
    throw new Error('Failed to parse certificate file');
  }

  const key = keyMatch[0];
  const cert = certMatches.join('\n');

  let deviceInfo: Record<string, unknown> | null = null;
  let served = false;

  const server = https.createServer({
    key,
    cert,
    // Sony cameras use old TLS versions. Allow all versions the runtime supports.
    minVersion: 'TLSv1' as const,
  }, (req: IncomingMessage, res: ServerResponse) => {
    if (req.method === 'POST') {
      // Camera sends its device info as POST body
      const chunks: Buffer[] = [];
      req.on('data', (chunk: Buffer) => chunks.push(chunk));
      req.on('end', () => {
        const body = Buffer.concat(chunks);
        try {
          deviceInfo = JSON.parse(body.toString('latin1'));
        } catch {
          // Ignore parse errors — camera data may not always be valid JSON
        }

        // Respond with install action (or empty actions if already served)
        let response: string;
        if (!served && spkData.length > 0) {
          // Tell the camera to download and install the app
          const serverUrl = `https://portal.localtest.me:${actualPort}/`;
          response = JSON.stringify({
            actions: [{
              command: 'dlandinstall',
              args: serverUrl,
              attrs: [{
                attrname: 'appname',
                attrvalue: 'app',
              }],
            }],
          });
        } else {
          // No more actions
          response = JSON.stringify({ actions: [] });
        }

        const responseData = Buffer.from(response, 'latin1');
        res.writeHead(200, {
          'Connection': 'Keep-Alive',
          'Content-Type': SPK_MIME_TYPE,
          'Content-Length': responseData.length.toString(),
        });
        res.end(responseData);
      });
    } else if (req.method === 'GET') {
      // Camera requests the SPK file download
      served = true;
      const spkBuffer = Buffer.from(spkData);
      res.writeHead(200, {
        'Connection': 'Keep-Alive',
        'Content-Type': SPK_MIME_TYPE,
        'Content-Length': spkBuffer.length.toString(),
        'Content-Disposition': `attachment;filename="app${SPK_EXTENSION}"`,
      });
      res.end(spkBuffer);
    } else {
      res.writeHead(405);
      res.end();
    }
  });

  let actualPort = port;

  return new Promise<MarketServerInstance>((resolve, reject) => {
    server.on('error', reject);

    server.listen(port, host, () => {
      const addr = server.address();
      if (addr && typeof addr === 'object') {
        actualPort = addr.port;
      }

      const instance: MarketServerInstance = {
        port: actualPort,
        url: `https://portal.localtest.me:${actualPort}/`,
        deviceInfo,
        close: () => {
          server.close();
        },
      };

      resolve(instance);
    });
  });
}
