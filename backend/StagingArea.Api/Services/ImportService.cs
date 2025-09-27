using Microsoft.EntityFrameworkCore;
using StagingArea.Api.Data;
using StagingArea.Api.Models;
using System.Net.Http.Json;
using System.Text.Json;

namespace StagingArea.Api.Services
{
    public class ImportService : IImportService
    {
        private readonly StagingDbContext _dbContext;
        private readonly HttpClient _httpClient;
        private readonly ILogger<ImportService> _logger;
        private readonly IConfiguration _configuration;

        public ImportService(StagingDbContext dbContext, ILogger<ImportService> logger, IConfiguration configuration)
        {
            _dbContext = dbContext;
            _logger = logger;
            _configuration = configuration;
            _httpClient = new HttpClient();
        }

        public async Task<ImportResult> ImportCustomersFromSourceAsync(CancellationToken cancellationToken = default)
        {
            var sourceUrl = _configuration["Sources:Customers"] ?? string.Empty;
            if (string.IsNullOrWhiteSpace(sourceUrl))
            {
                throw new InvalidOperationException("Sources:Customers URL is not configured.");
            }

            var raw = await _httpClient.GetStringAsync(sourceUrl, cancellationToken);
            using var doc = JsonDocument.Parse(raw);
            var items = doc.RootElement.ValueKind == JsonValueKind.Array
                ? doc.RootElement.EnumerateArray().ToArray()
                : Array.Empty<JsonElement>();

            int inserted = 0, updated = 0, invalid = 0;
            foreach (var item in items)
            {
                var externalId = item.GetPropertyOrDefault("id")?.GetString() ?? Guid.NewGuid().ToString("N");
                var name = item.GetPropertyOrDefault("name")?.GetString();
                var email = item.GetPropertyOrDefault("email")?.GetString();

                var (isValid, errors) = ValidateCustomer(name, email);
                var entity = await _dbContext.StagingCustomers
                    .FirstOrDefaultAsync(x => x.SourceSystem == "sample" && x.ExternalId == externalId, cancellationToken);

                if (entity == null)
                {
                    entity = new StagingCustomer
                    {
                        SourceSystem = "sample",
                        ExternalId = externalId,
                        Name = name,
                        Email = email,
                        RawJson = item.GetRawText(),
                        TransformJson = JsonSerializer.Serialize(new { name = name?.Trim(), email = email?.Trim()?.ToLowerInvariant() }),
                        IsValid = isValid,
                        ValidationErrors = isValid ? null : string.Join(";", errors)
                    };
                    _dbContext.StagingCustomers.Add(entity);
                    inserted++;
                }
                else
                {
                    entity.Name = name;
                    entity.Email = email;
                    entity.RawJson = item.GetRawText();
                    entity.TransformJson = JsonSerializer.Serialize(new { name = name?.Trim(), email = email?.Trim()?.ToLowerInvariant() });
                    entity.IsValid = isValid;
                    entity.ValidationErrors = isValid ? null : string.Join(";", errors);
                    updated++;
                }
            }

            await _dbContext.SaveChangesAsync(cancellationToken);
            return new ImportResult(inserted, updated, invalid, inserted + updated + invalid);
        }

        public async Task<ImportResult> ImportOrdersFromSourceAsync(CancellationToken cancellationToken = default)
        {
            var sourceUrl = _configuration["Sources:Orders"] ?? string.Empty;
            if (string.IsNullOrWhiteSpace(sourceUrl))
            {
                throw new InvalidOperationException("Sources:Orders URL is not configured.");
            }

            var raw = await _httpClient.GetStringAsync(sourceUrl, cancellationToken);
            using var doc = JsonDocument.Parse(raw);
            var items = doc.RootElement.ValueKind == JsonValueKind.Array
                ? doc.RootElement.EnumerateArray().ToArray()
                : Array.Empty<JsonElement>();

            int inserted = 0, updated = 0, invalid = 0;
            foreach (var item in items)
            {
                var externalId = item.GetPropertyOrDefault("id")?.GetString() ?? Guid.NewGuid().ToString("N");
                var customerId = item.GetPropertyOrDefault("customerId")?.GetString() ?? string.Empty;
                var orderDate = item.GetPropertyOrDefault("orderDate")?.GetDateTimeOrNull();
                var total = item.GetPropertyOrDefault("total")?.GetDecimalOrNull();

                var (isValid, errors) = ValidateOrder(customerId, orderDate, total);

                var entity = await _dbContext.StagingOrders
                    .FirstOrDefaultAsync(x => x.SourceSystem == "sample" && x.ExternalId == externalId, cancellationToken);

                if (entity == null)
                {
                    entity = new StagingOrder
                    {
                        SourceSystem = "sample",
                        ExternalId = externalId,
                        CustomerExternalId = customerId,
                        OrderDateUtc = orderDate,
                        TotalAmount = total,
                        RawJson = item.GetRawText(),
                        TransformJson = JsonSerializer.Serialize(new { orderDateUtc = orderDate, total = total }),
                        IsValid = isValid,
                        ValidationErrors = isValid ? null : string.Join(";", errors)
                    };
                    _dbContext.StagingOrders.Add(entity);
                    inserted++;
                }
                else
                {
                    entity.CustomerExternalId = customerId;
                    entity.OrderDateUtc = orderDate;
                    entity.TotalAmount = total;
                    entity.RawJson = item.GetRawText();
                    entity.TransformJson = JsonSerializer.Serialize(new { orderDateUtc = orderDate, total = total });
                    entity.IsValid = isValid;
                    entity.ValidationErrors = isValid ? null : string.Join(";", errors);
                    updated++;
                }
            }

            await _dbContext.SaveChangesAsync(cancellationToken);
            return new ImportResult(inserted, updated, invalid, inserted + updated + invalid);
        }

        private static (bool isValid, List<string> errors) ValidateCustomer(string? name, string? email)
        {
            var errors = new List<string>();
            if (string.IsNullOrWhiteSpace(name)) errors.Add("Name is required");
            if (string.IsNullOrWhiteSpace(email) || !email.Contains('@')) errors.Add("Valid email is required");
            return (errors.Count == 0, errors);
        }

        private static (bool isValid, List<string> errors) ValidateOrder(string customerId, DateTime? orderDateUtc, decimal? total)
        {
            var errors = new List<string>();
            if (string.IsNullOrWhiteSpace(customerId)) errors.Add("customerId is required");
            if (orderDateUtc == null) errors.Add("orderDate is required");
            if (total == null || total < 0) errors.Add("total must be >= 0");
            return (errors.Count == 0, errors);
        }
    }

    internal static class JsonElementExtensions
    {
        public static JsonElement? GetPropertyOrDefault(this JsonElement element, string name)
        {
            if (element.ValueKind == JsonValueKind.Object && element.TryGetProperty(name, out var value))
            {
                return value;
            }
            return null;
        }

        public static DateTime? GetDateTimeOrNull(this JsonElement element)
        {
            if (element.ValueKind == JsonValueKind.Null || element.ValueKind == JsonValueKind.Undefined) return null;
            if (element.ValueKind == JsonValueKind.String && DateTime.TryParse(element.GetString(), out var dt)) return dt;
            if (element.ValueKind == JsonValueKind.Number && element.TryGetInt64(out var unix)) return DateTimeOffset.FromUnixTimeSeconds(unix).UtcDateTime;
            return null;
        }

        public static decimal? GetDecimalOrNull(this JsonElement element)
        {
            if (element.ValueKind == JsonValueKind.Null || element.ValueKind == JsonValueKind.Undefined) return null;
            if (element.ValueKind == JsonValueKind.Number && element.TryGetDecimal(out var dec)) return dec;
            if (element.ValueKind == JsonValueKind.String && decimal.TryParse(element.GetString(), out var dec2)) return dec2;
            return null;
        }
    }
}


