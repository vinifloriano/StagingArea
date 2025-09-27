using System.ComponentModel.DataAnnotations;

namespace StagingArea.Api.Models
{
    public class StagingOrder
    {
        [Key]
        public int Id { get; set; }

        [MaxLength(100)]
        public string SourceSystem { get; set; } = "unknown";

        [Required]
        [MaxLength(100)]
        public string ExternalId { get; set; } = string.Empty;

        [Required]
        [MaxLength(100)]
        public string CustomerExternalId { get; set; } = string.Empty;

        public DateTime? OrderDateUtc { get; set; }

        public decimal? TotalAmount { get; set; }

        public string RawJson { get; set; } = string.Empty;

        public string? TransformJson { get; set; }

        public bool IsValid { get; set; }

        public string? ValidationErrors { get; set; }

        public DateTime CreatedAtUtc { get; set; } = DateTime.UtcNow;
    }
}


